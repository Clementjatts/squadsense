"""The scheduled job: fetch FPL data, run the model, save a snapshot.

Run it from the jobs/ folder:

    python -m squadsense.sync --team-id 11304359
    python -m squadsense.sync --team-id 11304359 --full

Without DATABASE_URL set, everything goes to jobs/.data/ as JSON files.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .fpl_client import FplApiError, FplClient
from .planner import best_lineup
from .snapshot import MODEL_VERSION, build_snapshot, run_model
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
    """Downloads match-by-match history for the given players.

    About one player a second, so a full refresh of ~750 players takes
    roughly 13 minutes. Hourly runs only refresh your squad.
    """
    for count, player_id in enumerate(player_ids, start=1):
        summary = client.element_summary(player_id)
        storage.save_player_history(player_id, summary["history"])
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


def read_real_squad(client, team_id, next_week, picks, team_entry, players_by_id, histories):
    """Rebuilds the team's actual squad, bank and transfers from public data."""
    started_event = team_entry["started_event"]
    return build_squad_state(
        team_id, next_week, started_event, picks,
        client.entry_history(team_id),
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


def histories_to_fetch(bootstrap, cached, priority_ids, full_refresh):
    """Player ids whose match history needs downloading this run.

    A full refresh gets everyone. Otherwise it's the priority players
    (the squad) plus anyone we've never fetched.
    """
    if full_refresh:
        return [player["id"] for player in bootstrap["elements"]]
    missing = [player["id"] for player in bootstrap["elements"] if player["id"] not in cached]
    return list(dict.fromkeys(priority_ids + missing))


def run(team_id, full_refresh, local_folder, web_snapshot_path, client=None):
    """Does one complete sync. Split out from main() so tests can call it."""
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
    picks = client.entry_picks(team_id, current_week) if is_public else None
    squad_ids = [pick["element"] for pick in picks["picks"]] if picks else []

    to_fetch = histories_to_fetch(bootstrap, storage.load_player_histories(), squad_ids, full_refresh)
    log.info("Refreshing %d player histories", len(to_fetch))
    refresh_histories(client, storage, to_fetch)
    histories = storage.load_player_histories()

    model_results = run_model(bootstrap, fixtures, histories, next_week)
    expected_points = model_results.expected_points
    players_by_id = {player["id"]: player for player in bootstrap["elements"]}
    if is_public:
        squad_state = read_real_squad(client, team_id, next_week, picks, team_entry, players_by_id, histories)
    else:
        squad_state = pick_model_squad(team_id, next_week, bootstrap, expected_points, players_by_id)
    snapshot = build_snapshot(bootstrap, fixtures, histories, model_results, squad_state, team_entry)

    storage.save_predictions(expected_points, MODEL_VERSION)
    storage.save_snapshot(team_id, next_week, snapshot)
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
