"""The scheduled job: fetch FPL data, run the model, save a snapshot per team.

Run it from the jobs/ folder:

    python -m squadsense.sync --team-id 11304359
    python -m squadsense.sync --team-id 11304359 --full
    python -m squadsense.sync --member-team 2222

A regular run does the shared work once (FPL's data, prices, player
histories, odds and the model), then the owner's team, then asks for a
separate run for each member's team. A `--member-team` run syncs only
that team, on the shared data the last regular run saved.

Without DATABASE_URL set, everything goes to jobs/.data/ as JSON files.
"""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import os
import sys
from pathlib import Path

from . import alerts, changes, leagues, odds, review, rules
from .fpl_client import FplApiError, FplClient
from .planner import best_lineup
from .price_watch import predictions_record
from .snapshot import MODEL_VERSION, SnapshotExtras, build_snapshot, run_model
from .squad_builder import pick_best_squad
from .squad_state import apply_made_moves, build_squad_state, marked_move_mismatches, model_squad_state
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


def apply_marked_moves(storage, squad_state, players_by_id):
    """The squad after the moves Clement marked "Done on FPL" for the coming week, and the marks used.

    FPL hides transfers until the deadline, so the public squad is the one
    from before them. A mark that no longer fits is logged and left out.
    """
    marks = storage.load_made_moves(squad_state.team_id, squad_state.gameweek)
    squad_state, applied, skipped = apply_made_moves(squad_state, marks, players_by_id)
    for move in skipped:
        log.warning("Skipped a move marked done (player %s out, %s in): it doesn't fit the squad", move["out"], move["in"])
    return squad_state, applied


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
    """Your picks and saved forecasts for every finished week since your team started.

    Returns ({gameweek: picks}, {gameweek: forecast}); both are empty if no
    week has finished or the squad isn't public yet. Picks for a finished
    week never change, so each one is fetched once and then read from the
    cache. A missing forecast (from before the sync ran) is simply left out.
    """
    event = review.last_finished_week(bootstrap)
    if event is None or not is_public:
        return {}, {}
    weeks = range(team_entry["started_event"], event["id"] + 1)
    picks = {week: leagues.cached_picks(client, storage, team_id, week) for week in weeks}
    forecasts = {week: storage.load_raw(review.forecast_name(team_id, week)) for week in weeks}
    return ({week: found for week, found in picks.items() if found},
            {week: found for week, found in forecasts.items() if found})


def reviewed_week_points(client, storage, bootstrap):
    """FPL's final points for every player in the reviewed week, fetched once and then read from the cache.

    None (with a warning) if no week has finished or FPL can't be reached;
    the review then falls back to the saved player histories.
    """
    event = review.last_finished_week(bootstrap)
    if event is None:
        return None
    name = f"final_points/{event['id']}"
    saved = storage.load_raw(name)
    if saved is None:
        try:
            saved = review.live_week_points(client.event_live(event["id"]))
        except FplApiError as error:
            log.warning("Couldn't read FPL's final points for GW%d, so the review uses saved histories: %s", event["id"], error)
            return None
        storage.save_raw(name, saved)
    # Saved as JSON, so the player ids come back as text.
    return {int(player_id): points for player_id, points in saved.items()}


def live_picks(storage, client, team_id, current_week, is_public, league_data, bootstrap):
    """Every team's picks for the gameweek being played, for the Live page.

    The website adds up live points from these, so it needs the
    multipliers (captain, bench), each team's total before the week (FPL
    has already taken this week's hits off it) and your own hits. `elements` gives every player's club and position, which
    the automatic substitutions need, and his short name for the ownership list.
    """
    mine = leagues.cached_picks(client, storage, team_id, current_week) if is_public else None
    # Live totals need every team's picks, which only fully analysed leagues have.
    league_data = [league for league in league_data if league["kind"] == "full"]
    for league in league_data:
        league["picks"][team_id] = mine
    hits = lambda picks: ((picks or {}).get("entry_history") or {}).get("event_transfers_cost", 0)
    return {
        "gameweek": current_week,
        "elements": {str(player["id"]): [player["team"], player["element_type"], player["web_name"]] for player in bootstrap["elements"]},
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


class TeamSyncFailed(Exception):
    """One or more teams couldn't be synced. The others carried on; `team_ids` lists the ones that failed."""

    def __init__(self, team_ids):
        super().__init__(f"Sync failed for team {', '.join(str(team) for team in team_ids)} (see the log above)")
        self.team_ids = team_ids


@dataclass
class SharedData:
    """Everything the teams share in one run: FPL's data, player histories and the model's results."""

    bootstrap: dict
    fixtures: list
    rule_changes: list
    histories: dict
    model_results: object
    current_week: int
    next_week: int

    @property
    def players_by_id(self):
        return {player["id"]: player for player in self.bootstrap["elements"]}


@dataclass
class TeamStart:
    """A team's FPL entry and the picks to plan with (None while its squad is hidden)."""

    team_entry: dict
    is_public: bool
    picks: dict | None

    @property
    def squad_ids(self):
        return [pick["element"] for pick in self.picks["picks"]] if self.picks else []


def download_shared(client, storage, run_started):
    """Downloads FPL's data and saves it with the day's prices. Returns (bootstrap, fixtures, rule changes).

    Only regular runs do this; one-team runs read what it saved.
    """
    bootstrap = client.bootstrap()
    rule_changes = apply_rules(bootstrap)
    fixtures = client.fixtures()
    storage.save_raw("bootstrap-static", bootstrap)
    storage.save_raw("fixtures", fixtures)
    storage.save_price_snapshot(bootstrap["elements"])
    # One record per UK day; later runs overwrite earlier ones, so the last
    # run before 00:00 is what price_audit.py checks against the next day.
    record = predictions_record(bootstrap, run_started)
    storage.save_raw(f"price_predictions/{record['day']}", record)
    return bootstrap, fixtures, rule_changes


def apply_rules(bootstrap):
    """Uses FPL's published rules for this run and logs any that differ from the typed-in ones."""
    rule_changes = rules.apply_fpl_settings(bootstrap)
    for difference in rule_changes:
        log.warning("FPL changed a rule: %s", difference)
    return rule_changes


def refresh_shared_histories(client, storage, bootstrap, fixtures, priority_ids, full_refresh):
    """Downloads the player histories this run needs (see histories_to_fetch)."""
    to_fetch = histories_to_fetch(bootstrap, storage.load_player_histories(), storage.load_player_pasts(), priority_ids, full_refresh, fixtures)
    log.info("Refreshing %d player histories", len(to_fetch))
    refresh_histories(client, storage, to_fetch)


def build_shared(storage, bootstrap, fixtures, rule_changes, odds_client=None):
    """Runs the model on the saved player histories. Every team in the run uses its results."""
    current_week, next_week = find_gameweeks(bootstrap)
    histories = storage.load_player_histories()
    market = market_expected_goals(storage, bootstrap, fixtures, next_week, odds_client)
    model_results = run_model(bootstrap, fixtures, histories, next_week, storage.load_player_pasts(), market)
    return SharedData(bootstrap, fixtures, rule_changes, histories, model_results, current_week, next_week)


def load_shared(storage, odds_client=None):
    """The shared data for a one-team run: FPL's data and histories as the last regular run saved them.

    Nothing shared is downloaded again; the model is rerun on the saved data.
    """
    bootstrap = storage.load_raw("bootstrap-static")
    fixtures = storage.load_raw("fixtures")
    if bootstrap is None or fixtures is None:
        raise SystemExit("No saved FPL data yet, so one team can't be synced on its own: run a regular sync first")
    return build_shared(storage, bootstrap, fixtures, apply_rules(bootstrap), odds_client)


def read_team_start(client, team_id, current_week):
    """Reads a team's FPL entry and, once its squad is public, the picks to plan with."""
    team_entry = client.entry(team_id)
    is_public = squad_is_public(team_entry, current_week)
    picks = squad_picks(client, team_id, current_week, team_entry["started_event"]) if is_public else None
    return TeamStart(team_entry, is_public, picks)


def team_squad(client, storage, shared, team_id, start, entry_history):
    """(squad state, moves marked done that were applied, marks missing from the real squad) for one team."""
    players_by_id = shared.players_by_id
    if not start.is_public:
        return pick_model_squad(team_id, shared.next_week, shared.bootstrap, shared.model_results.expected_points, players_by_id), [], []
    squad_state = read_real_squad(client, team_id, shared.next_week, start.picks, start.team_entry, entry_history, players_by_id, shared.histories)
    squad_state, made_moves = apply_marked_moves(storage, squad_state, players_by_id)
    mismatches = marked_move_mismatches(storage.load_made_moves(team_id, shared.current_week), start.squad_ids)
    return squad_state, made_moves, mismatches


def run_team(client, storage, shared, member, start=None, web_snapshot_path=None):
    """Syncs one member's team on the shared data: squad, marks, plan, leagues, review, snapshot and alerts.

    `start` is the team's entry and picks when the caller already read them.
    SQUADSENSE_LEAGUES only narrows the owner's leagues; members get every
    private league they're in. Returns the snapshot.
    """
    team_started = datetime.now(timezone.utc)
    team_id = member["teamId"]
    start = start or read_team_start(client, team_id, shared.current_week)
    team_entry, is_public = start.team_entry, start.is_public
    entry_history = client.entry_history(team_id) if is_public else None
    squad_state, made_moves, mismatches = team_squad(client, storage, shared, team_id, start, entry_history)

    chosen_leagues = leagues.league_ids_from_env() if member["role"] == "owner" else None
    league_data = leagues.fetch_leagues(client, storage, team_entry, shared.current_week, chosen_leagues)
    picks_by_week, forecasts_by_week = review_inputs(client, storage, team_id, team_entry, shared.bootstrap, is_public)
    reviewed = review.last_finished_week(shared.bootstrap)
    reviewed_week = reviewed["id"] if reviewed else None
    snapshot = build_snapshot(
        shared.bootstrap, shared.fixtures, shared.histories, shared.model_results, squad_state, team_entry,
        extras=SnapshotExtras(
            league_data=league_data,
            review=review.build_review(
                shared.bootstrap, shared.histories, entry_history, picks_by_week.get(reviewed_week), forecasts_by_week.get(reviewed_week),
                picks_by_week, forecasts_by_week, live_points=reviewed_week_points(client, storage, shared.bootstrap),
            ),
            live_picks=live_picks(storage, client, team_id, shared.current_week, is_public, league_data, shared.bootstrap),
            storage=storage,
        ),
    )

    snapshot["ruleChanges"] = shared.rule_changes
    snapshot["madeMoves"] = made_moves
    snapshot["madeMoveMismatches"] = mismatches
    snapshot["changes"] = changes.update_feed(storage, team_id, snapshot)
    lineup = snapshot["lineups"][str(shared.next_week)]
    review.save_forecast(storage, team_id, shared.next_week, lineup, squad_state.player_ids, shared.model_results.expected_points)
    storage.save_snapshot(team_id, shared.next_week, snapshot)
    alerts.run_alerts(storage, snapshot, member)
    if web_snapshot_path:
        Path(web_snapshot_path).write_text(json.dumps(snapshot, indent=1))
        log.info("Wrote website snapshot to %s", web_snapshot_path)
    log.info("Team %d synced in %.0f seconds", team_id, (datetime.now(timezone.utc) - team_started).total_seconds())
    return snapshot


def attempt(team_id, step, failed, action):
    """Runs one team's step. If it fails, logs the error with the team id, adds the team to `failed` and returns None.

    One team's problem (an FPL error, a squad that can't be read) never
    stops the others; the run still fails at the end (TeamSyncFailed).
    """
    try:
        return action()
    except Exception:
        log.exception("Team %d: %s failed", team_id, step)
        failed.append(team_id)
        return None


def split_owner(members):
    """(the owner's member row or None, everyone else) from storage.load_members()."""
    owner = next((member for member in members if member["role"] == "owner"), None)
    return owner, [member for member in members if member is not owner]


def run(team_id, full_refresh, local_folder, web_snapshot_path, client=None, odds_client=None):
    """A regular sync: the shared work once, then the owner's team, then one separate run per member.

    `team_id` is the owner's team when no member has signed up yet (see
    storage.load_members). Members' teams run on their own GitHub runners,
    asked for through storage.start_team_sync. A full refresh also clears
    old cache rows. Returns the owner's snapshot, or raises TeamSyncFailed
    at the end if any team failed. Split out from main() so tests can call it.
    """
    run_started = datetime.now(timezone.utc)
    client = client or FplClient()
    storage = choose_storage(local_folder)
    members = storage.load_members(team_id)
    if not members:
        raise SystemExit("No teams to sync: no members have signed up and FPL_TEAM_ID isn't set")
    owner, others = split_owner(members)
    if owner is None:
        log.warning("No member is the owner, so every team gets its own run")

    bootstrap, fixtures, rule_changes = download_shared(client, storage, run_started)
    current_week, _ = find_gameweeks(bootstrap)
    failed = []
    start = attempt(owner["teamId"], "reading the squad", failed, lambda: read_team_start(client, owner["teamId"], current_week)) if owner else None
    refresh_shared_histories(client, storage, bootstrap, fixtures, start.squad_ids if start else [], full_refresh)
    shared = build_shared(storage, bootstrap, fixtures, rule_changes, odds_client)
    storage.save_predictions(shared.model_results.expected_points, MODEL_VERSION)

    snapshot = attempt(owner["teamId"], "the sync", failed, lambda: run_team(client, storage, shared, owner, start, web_snapshot_path)) if start else None
    for member in others:
        attempt(member["teamId"], "starting its own run", failed, lambda: storage.start_team_sync(member["teamId"]))
    if full_refresh:
        pruned = storage.prune_cache(current_week, run_started.date(), [member["teamId"] for member in members])
        log.info("Cleared %d old cache rows", pruned)
    if failed:
        raise TeamSyncFailed(failed)
    return snapshot


def run_member(team_id, local_folder, web_snapshot_path=None, client=None, odds_client=None):
    """A one-team run (a new member's first sync, or after a Done on FPL mark).

    Uses the shared data the last regular run saved, so it downloads only
    this team's own data, and rewrites only this team's rows and per-key
    cache entries. Returns the snapshot, or raises TeamSyncFailed.
    """
    client = client or FplClient()
    storage = choose_storage(local_folder)
    member = next((member for member in storage.load_members() if member["teamId"] == team_id), None)
    if member is None:
        log.error("Team %d isn't an active member, so it wasn't synced", team_id)
        raise TeamSyncFailed([team_id])
    shared = load_shared(storage, odds_client)
    failed = []
    snapshot = attempt(team_id, "the sync", failed, lambda: run_team(client, storage, shared, member, web_snapshot_path=web_snapshot_path))
    if failed:
        raise TeamSyncFailed(failed)
    return snapshot


def main():
    """Command line: a regular sync, or one team's with --member-team."""
    parser = argparse.ArgumentParser(description="Fetch FPL data and refresh SquadSense predictions.")
    parser.add_argument("--team-id", type=int, default=os.environ.get("FPL_TEAM_ID"), help="Your FPL team ID, used when no member has signed up")
    parser.add_argument("--member-team", type=int, help="Sync only this team, on the shared data the last regular run saved")
    parser.add_argument("--full", action="store_true", help="Refresh every player's history (slow, ~13 min)")
    parser.add_argument("--local-folder", default=".data", help="Folder for local runs without Postgres")
    parser.add_argument("--web-snapshot", help="Also write the snapshot here, e.g. ../web/data/snapshot.json")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        if args.member_team:
            run_member(args.member_team, args.local_folder, args.web_snapshot)
        else:
            run(int(args.team_id) if args.team_id else None, args.full, args.local_folder, args.web_snapshot)
    except FplApiError as error:
        log.error("FPL API problem: %s", error)
        sys.exit(1)
    except TeamSyncFailed as error:
        log.error("%s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
