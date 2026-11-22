"""The scheduled job: fetch FPL data, run the model, save a snapshot.

Run it from the jobs/ folder:

    python -m squadsense.sync --team-id 11304359
    python -m squadsense.sync --team-id 11304359 --full

Without DATABASE_URL set, everything goes to jobs/.data/ as JSON files.
"""

import argparse
from datetime import datetime, timezone
import json
import logging
import os
import sys
from pathlib import Path

from . import alerts, changes, leagues, odds, review
from .fpl_client import FplApiError, FplClient
from .planner import best_lineup
from .snapshot import MODEL_VERSION, SnapshotExtras, build_snapshot, run_model
from .squad_builder import SquadBuilderError, pick_best_squad
from .squad_state import build_squad_state, model_squad_state
from .storage import FileStorage, PostgresStorage

log = logging.getLogger("squadsense.sync")


def choose_storage(local_folder):
    """Uses Supabase when DATABASE_URL is set, local files otherwise."""
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        log.info("Saving to Postgres")
        return PostgresStorage(database_url)
    log.info("DATABASE_URL not set, saving to %s", local_folder)
    return FileStorage(local_folder)


def find_gameweeks(bootstrap):
    """Returns (last started gameweek, next gameweek to plan for)."""
    current = next((event["id"] for event in bootstrap["events"] if event["is_current"]), None)
    upcoming = next((event["id"] for event in bootstrap["events"] if event["is_next"]), None)
    if current is None or upcoming is None:
        raise SystemExit("No current or next gameweek in FPL data. The season may not have started, or it has ended.")
    return current, upcoming


def refresh_histories(client, storage, player_ids):
    """Downloads match-by-match history and past-season totals for the given players.

    About one player a second, so a full refresh of ~750 players takes
    roughly 13 minutes. Hourly runs only refresh your squad.
    """
    for count, player_id in enumerate(player_ids, start=1):
        summary = client.element_summary(player_id)
        storage.save_player_history(player_id, summary["history"])
        storage.save_player_past(player_id, summary.get("history_past", []))
        if count % 50 == 0:
            log.info("Fetched %d of %d player histories", count, len(player_ids))


def starting_price_lookup_from(histories, started_event):
    """Builds a function giving a player's price when the squad was picked.

    That's his price in his first match from `started_event` onwards, so a
    team created in GW11 gets GW11 prices, not GW1 prices. Returns None
    when he hasn't played since then (for example, the team's first
    gameweek hasn't kicked off yet), and the caller treats that as a guess.
    """
    def lookup(player_id):
        rows = histories.get(player_id, [])
        since_start = [row for row in rows if row["round"] >= started_event]
        return since_start[0]["value"] if since_start else None
    return lookup


def squad_is_public(team_entry, current_week):
    """True once the team's first deadline has passed.

    FPL hides a team's picks until its first gameweek's deadline, so a
    team that starts next week has nothing public to read yet.
    """
    return team_entry["started_event"] <= current_week


def squad_picks(client, team_id, current_week, started_event):
    """The picks to plan with: this week's, or last week's during a Free Hit.

    A Free Hit squad only lasts one gameweek. Its picks show the temporary
    squad, but next week the team goes back to the squad (and bank) from
    the week before, so that's the one to plan transfers around.
    """
    picks = client.entry_picks(team_id, current_week)
    if picks.get("active_chip") != "freehit":
        return picks
    previous_week = current_week - 1
    if previous_week < started_event:
        raise FplApiError(f"GW{current_week} shows a Free Hit but the team has no earlier gameweek to go back to")
    log.info("Free Hit played in GW%d, so planning with the GW%d squad that comes back", current_week, previous_week)
    return client.entry_picks(team_id, previous_week)


def read_real_squad(client, team_id, next_week, picks, team_entry, entry_history, players_by_id, histories):
    """Rebuilds the team's actual squad, bank and transfers from public data."""
    started_event = team_entry["started_event"]
    return build_squad_state(
        team_id, next_week, started_event, picks,
        entry_history,
        client.entry_transfers(team_id),
        players_by_id,
        starting_price_lookup_from(histories, started_event),
    )


def pick_model_squad(team_id, next_week, bootstrap, expected_points, players_by_id):
    """Picks the best squad for next week, for a team whose picks are still hidden."""
    log.info("Squad not public until the GW%d deadline, so the model is picking one", next_week)
    player_ids = pick_best_squad(bootstrap["elements"], expected_points, next_week)
    lineup = best_lineup(player_ids, players_by_id, expected_points, next_week)
    return model_squad_state(team_id, next_week, player_ids, lineup, players_by_id)


RECENT_MATCH_HOURS = 36  # a full refresh re-downloads players whose club played this recently


def clubs_that_played_recently(fixtures, now=None):
    """Club ids with a match that kicked off in the last RECENT_MATCH_HOURS."""
    now = now or datetime.now(timezone.utc)
    clubs = set()
    for fixture in fixtures:
        kickoff = fixture.get("kickoff_time")
        if fixture.get("started") and kickoff:
            hours_ago = (now - datetime.fromisoformat(kickoff.replace("Z", "+00:00"))).total_seconds() / 3600
            if 0 <= hours_ago <= RECENT_MATCH_HOURS:
                clubs.update((fixture["team_h"], fixture["team_a"]))
    return clubs


def histories_to_fetch(bootstrap, cached, cached_pasts, priority_ids, full_refresh, fixtures=()):
    """Player ids whose match history needs downloading this run.

    Always: the priority players (the squad) and anyone whose history or
    past seasons we don't have. A full refresh adds every player whose
    club played in the last RECENT_MATCH_HOURS, which is everyone after a
    full matchday and almost nobody on a quiet night, so the nightly run
    only spends time when there's something new.
    """
    missing = [player["id"] for player in bootstrap["elements"] if player["id"] not in cached or player["id"] not in cached_pasts]
    recent = []
    if full_refresh:
        clubs = clubs_that_played_recently(fixtures)
        recent = [player["id"] for player in bootstrap["elements"] if player["team"] in clubs]
    return list(dict.fromkeys(priority_ids + missing + recent))


def review_inputs(client, storage, team_id, team_entry, bootstrap, is_public):
    """The picks, history and forecast the gameweek review needs, or Nones.

    The picks are only read if the team had started by the reviewed week.
    """
    event = review.last_finished_week(bootstrap)
    if event is None or not is_public or team_entry["started_event"] > event["id"]:
        return None, None
    picks = leagues.cached_picks(client, storage, team_id, event["id"])
    return picks, storage.load_raw(review.forecast_name(team_id, event["id"]))


def live_picks(storage, client, team_id, current_week, is_public, league_data, bootstrap):
    """Every team's picks for the gameweek being played, for the Live page.

    The website adds up live points from these, so it needs the
    multipliers (captain, bench), each team's total before the week (FPL
    has already taken this week's hits off it) and your own hits. `elements` gives every player's club and position, which
    the automatic substitutions need.
    """
    mine = leagues.cached_picks(client, storage, team_id, current_week) if is_public else None
    # Live totals need every team's picks, which only fully analysed leagues have.
    league_data = [league for league in league_data if league["kind"] == "full"]
    for league in league_data:
        league["picks"][team_id] = mine
    hits = lambda picks: ((picks or {}).get("entry_history") or {}).get("event_transfers_cost", 0)
    return {
        "gameweek": current_week,
        "elements": {str(player["id"]): [player["team"], player["element_type"]] for player in bootstrap["elements"]},
        "mine": {"picks": mine["picks"], "active_chip": mine.get("active_chip"), "hits": hits(mine)} if mine else None,
        "leagues": [
            {
                "id": league["info"]["id"],
                "name": league["info"]["name"],
                "teams": [
                    {
                        "entry": row["entry"],
                        "teamName": row["entry_name"],
                        "totalBefore": row["total"] - row["event_total"],
                        "picks": (league["picks"].get(row["entry"]) or {}).get("picks", []),
                        "chip": (league["picks"].get(row["entry"]) or {}).get("active_chip"),
                    }
                    for row in league["standings"]
                ],
            }
            for league in league_data
        ],
    }


def season_start_year(bootstrap):
    """The year the season started in, from GW1's deadline (2026 for 2026/27)."""
    return int(bootstrap["events"][0]["deadline_time"][:4])


def market_expected_goals(storage, bootstrap, fixtures, first_week, odds_client=None):
    """Expected goals from bookmaker odds for the planning window, or {} if they can't be read.

    Odds are a bonus: if football-data.co.uk is down, the sync carries on
    with our own ratings and logs a warning.
    """
    try:
        data = odds.load_odds_data(storage, season_start_year(bootstrap), odds_client)
    except odds.OddsError as error:
        log.warning("No bookmaker odds this run: %s", error)
        return {}
    market = odds.market_goals(data["upcoming"], bootstrap["teams"], fixtures, first_week, first_week + 4)
    log.info("Bookmaker odds found for %d matches", len(market) // 2)
    return market


def run(team_id, full_refresh, local_folder, web_snapshot_path, client=None, odds_client=None):
    """Does one complete sync, then sends any new alerts. Split out from main() so tests can call it."""
    run_started = datetime.now(timezone.utc)
    client = client or FplClient()
    storage = choose_storage(local_folder)

    bootstrap = client.bootstrap()
    fixtures = client.fixtures()
    storage.save_raw("bootstrap-static", bootstrap)
    storage.save_raw("fixtures", fixtures)
    storage.save_price_snapshot(bootstrap["elements"])

    current_week, next_week = find_gameweeks(bootstrap)
    team_entry = client.entry(team_id)
    is_public = squad_is_public(team_entry, current_week)
    picks = squad_picks(client, team_id, current_week, team_entry["started_event"]) if is_public else None
    squad_ids = [pick["element"] for pick in picks["picks"]] if picks else []

    to_fetch = histories_to_fetch(bootstrap, storage.load_player_histories(), storage.load_player_pasts(), squad_ids, full_refresh, fixtures)
    log.info("Refreshing %d player histories", len(to_fetch))
    refresh_histories(client, storage, to_fetch)
    histories = storage.load_player_histories()

    market = market_expected_goals(storage, bootstrap, fixtures, next_week, odds_client)
    model_results = run_model(bootstrap, fixtures, histories, next_week, storage.load_player_pasts(), market)
    expected_points = model_results.expected_points
    players_by_id = {player["id"]: player for player in bootstrap["elements"]}
    entry_history = client.entry_history(team_id) if is_public else None
    if is_public:
        squad_state = read_real_squad(client, team_id, next_week, picks, team_entry, entry_history, players_by_id, histories)
    else:
        squad_state = pick_model_squad(team_id, next_week, bootstrap, expected_points, players_by_id)

    league_data = leagues.fetch_leagues(client, storage, team_entry, current_week, leagues.league_ids_from_env())
    review_picks, forecast = review_inputs(client, storage, team_id, team_entry, bootstrap, is_public)
    snapshot = build_snapshot(
        bootstrap, fixtures, histories, model_results, squad_state, team_entry,
        extras=SnapshotExtras(
            league_data=league_data,
            review=review.build_review(bootstrap, histories, entry_history, review_picks, forecast),
            live_picks=live_picks(storage, client, team_id, current_week, is_public, league_data, bootstrap),
            storage=storage,
        ),
    )

    snapshot["changes"] = changes.update_feed(storage, team_id, snapshot)
    lineup = snapshot["lineups"][str(next_week)]
    review.save_forecast(storage, team_id, next_week, lineup, squad_state.player_ids, expected_points)
    storage.save_predictions(expected_points, MODEL_VERSION)
    storage.save_snapshot(team_id, next_week, snapshot)
    alerts.run_alerts(storage, snapshot, run_started)
    if web_snapshot_path:
        Path(web_snapshot_path).write_text(json.dumps(snapshot, indent=1))
        log.info("Wrote website snapshot to %s", web_snapshot_path)
    return snapshot


def main():
    parser = argparse.ArgumentParser(description="Fetch FPL data and refresh SquadSense predictions.")
    parser.add_argument("--team-id", type=int, default=os.environ.get("FPL_TEAM_ID"), help="Your FPL team ID")
    parser.add_argument("--full", action="store_true", help="Refresh every player's history (slow, ~13 min)")
    parser.add_argument("--local-folder", default=".data", help="Folder for local runs without Postgres")
    parser.add_argument("--web-snapshot", help="Also write the snapshot here, e.g. ../web/data/snapshot.json")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.team_id:
        parser.error("Give --team-id or set FPL_TEAM_ID")

    try:
        run(int(args.team_id), args.full, args.local_folder, args.web_snapshot)
    except FplApiError as error:
        log.error("FPL API problem: %s", error)
        sys.exit(1)
    except SquadBuilderError as error:
        log.error("Couldn't pick a model squad: %s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
