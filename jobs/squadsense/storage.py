"""Where the jobs keep their data: Supabase (Postgres) or local files.

Both classes have the same methods, so the sync job doesn't care which
one it's using. Local files are handy for trying things on your Mac
before Supabase is set up; Postgres is what the scheduled job uses.
"""

import json
from datetime import datetime, timezone
from pathlib import Path


def _now():
    return datetime.now(timezone.utc)


class FileStorage:
    """Keeps everything as JSON files in one folder."""

    def __init__(self, folder):
        self.folder = Path(folder)
        (self.folder / "history").mkdir(parents=True, exist_ok=True)
        (self.folder / "career").mkdir(parents=True, exist_ok=True)

    def _write(self, path, data):
        path.write_text(json.dumps(data, indent=1, default=str))

    def save_raw(self, name, data):
        """Saves an API response as-is, so the model can be rerun on old data."""
        self._write(self._raw_path(name), data)

    def load_raw(self, name):
        """A response saved with save_raw, or None if there isn't one."""
        path = self._raw_path(name)
        return json.loads(path.read_text()) if path.exists() else None

    def _raw_path(self, name):
        return self.folder / f"raw_{name.replace('/', '_')}.json"

    def save_player_history(self, player_id, rows):
        self._write(self.folder / "history" / f"{player_id}.json", rows)

    def load_player_histories(self):
        """Returns {player_id: history rows} for every player saved so far."""
        histories = {}
        for path in (self.folder / "history").glob("*.json"):
            histories[int(path.stem)] = json.loads(path.read_text())
        return histories

    def save_player_past(self, player_id, seasons):
        """Saves a player's past-season totals (element-summary `history_past`)."""
        self._write(self.folder / "career" / f"{player_id}.json", seasons)

    def load_player_pasts(self):
        """Returns {player_id: past-season rows} for every player saved so far."""
        return {int(path.stem): json.loads(path.read_text()) for path in (self.folder / "career").glob("*.json")}

    def save_predictions(self, expected_points, model_version):
        self._write(self.folder / f"predictions_{model_version}.json", expected_points)

    def save_price_snapshot(self, players):
        """Appends tonight's prices and transfer counts, for the price predictor later."""
        log_path = self.folder / "price_snapshots.jsonl"
        with log_path.open("a") as log_file:
            for player in players:
                log_file.write(json.dumps({
                    "taken_at": _now().isoformat(),
                    "player_id": player["id"],
                    "now_cost": player["now_cost"],
                    "transfers_in_event": player["transfers_in_event"],
                    "transfers_out_event": player["transfers_out_event"],
                    "selected_by_percent": player["selected_by_percent"],
                }) + "\n")

    def save_snapshot(self, team_id, gameweek, snapshot):
        self._write(self.folder / f"snapshot_{team_id}.json", snapshot)


# Supabase's free plan has 500 MB, so old rows are cleared as new ones arrive.
SNAPSHOTS_KEPT = 3  # per team; each snapshot is about 1.4 MB, and the website only reads the newest
PRICE_HISTORY_DAYS = 60  # price rows older than this are deleted


class PostgresStorage:
    """Writes to the Supabase database described in db/schema.sql."""

    def __init__(self, database_url):
        # Imported here so local runs without Postgres don't need the package.
        import psycopg

        self.connection = psycopg.connect(database_url, autocommit=True)

    def _execute(self, sql, params):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)

    def save_raw(self, name, data):
        self._execute(
            """insert into api_cache (path, body, fetched_at) values (%s, %s, now())
               on conflict (path) do update set body = excluded.body, fetched_at = now()""",
            (name, json.dumps(data)),
        )

    def load_raw(self, name):
        with self.connection.cursor() as cursor:
            cursor.execute("select body from api_cache where path = %s", (name,))
            row = cursor.fetchone()
            return row[0] if row else None

    def save_player_history(self, player_id, rows):
        self._execute(
            """insert into player_history (player_id, rows, fetched_at) values (%s, %s, now())
               on conflict (player_id) do update set rows = excluded.rows, fetched_at = now()""",
            (player_id, json.dumps(rows)),
        )

    def load_player_histories(self):
        with self.connection.cursor() as cursor:
            cursor.execute("select player_id, rows from player_history")
            return {player_id: rows for player_id, rows in cursor.fetchall()}

    def save_player_past(self, player_id, seasons):
        self._execute(
            """insert into player_past (player_id, seasons, fetched_at) values (%s, %s, now())
               on conflict (player_id) do update set seasons = excluded.seasons, fetched_at = now()""",
            (player_id, json.dumps(seasons)),
        )

    def load_player_pasts(self):
        with self.connection.cursor() as cursor:
            cursor.execute("select player_id, seasons from player_past")
            return {player_id: seasons for player_id, seasons in cursor.fetchall()}

    def save_predictions(self, expected_points, model_version):
        """Saves every xP in one batch (about 3,400 rows), rather than one round trip each."""
        with self.connection.cursor() as cursor:
            cursor.executemany(
                """insert into predictions (player_id, gameweek, model_version, xp, created_at)
                   values (%s, %s, %s, %s, now())
                   on conflict (player_id, gameweek, model_version)
                   do update set xp = excluded.xp, created_at = now()""",
                [
                    (player_id, gameweek, model_version, points)
                    for player_id, weeks in expected_points.items()
                    for gameweek, points in weeks.items()
                ],
            )

    def save_price_snapshot(self, players):
        with self.connection.cursor() as cursor:
            cursor.executemany(
                """insert into price_snapshots
                   (player_id, now_cost, transfers_in_event, transfers_out_event, selected_by_percent)
                   values (%s, %s, %s, %s, %s)""",
                [
                    (p["id"], p["now_cost"], p["transfers_in_event"], p["transfers_out_event"],
                     float(p["selected_by_percent"]))
                    for p in players
                ],
            )
            cursor.execute(
                "delete from price_snapshots where taken_at < now() - make_interval(days => %s)",
                (PRICE_HISTORY_DAYS,),
            )

    def save_snapshot(self, team_id, gameweek, snapshot):
        """Saves the new snapshot and deletes all but the newest SNAPSHOTS_KEPT for this team."""
        self._execute(
            "insert into snapshots (team_id, gameweek, body) values (%s, %s, %s)",
            (team_id, gameweek, json.dumps(snapshot, default=str)),
        )
        self._execute(
            """delete from snapshots where team_id = %s and id not in (
                 select id from snapshots where team_id = %s order by created_at desc limit %s
               )""",
            (team_id, team_id, SNAPSHOTS_KEPT),
        )
