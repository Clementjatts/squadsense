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

    def _write(self, path, data):
        path.write_text(json.dumps(data, indent=1, default=str))

    def save_raw(self, name, data):
        """Saves an API response as-is, so the model can be rerun on old data."""
        self._write(self.folder / f"raw_{name.replace('/', '_')}.json", data)

    def save_player_history(self, player_id, rows):
        self._write(self.folder / "history" / f"{player_id}.json", rows)

    def load_player_histories(self):
        """Returns {player_id: history rows} for every player saved so far."""
        histories = {}
        for path in (self.folder / "history").glob("*.json"):
            histories[int(path.stem)] = json.loads(path.read_text())
        return histories

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

    def save_predictions(self, expected_points, model_version):
        with self.connection.cursor() as cursor:
            for player_id, weeks in expected_points.items():
                for gameweek, points in weeks.items():
                    cursor.execute(
                        """insert into predictions (player_id, gameweek, model_version, xp, created_at)
                           values (%s, %s, %s, %s, now())
                           on conflict (player_id, gameweek, model_version)
                           do update set xp = excluded.xp, created_at = now()""",
                        (player_id, gameweek, model_version, points),
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

    def save_snapshot(self, team_id, gameweek, snapshot):
        self._execute(
            "insert into snapshots (team_id, gameweek, body) values (%s, %s, %s)",
            (team_id, gameweek, json.dumps(snapshot, default=str)),
        )
