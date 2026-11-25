"""Where the jobs keep their data: Supabase (Postgres) or local files.

Both classes have the same methods, so the sync job doesn't care which
one it's using. Local files are handy for trying things on your Mac
before Supabase is set up; Postgres is what the scheduled job uses.
"""

import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("squadsense.storage")

# The nightly clean-up (prune_cache) deletes cache rows nothing reads any more.
GAMEWEEKS_KEPT = 3  # per-gameweek rows more than this many weeks behind the current one go
PRICE_PREDICTION_DAYS_KEPT = 30  # price_audit.py only compares each day with the next
WEEKLY_NAME = re.compile(r"^(picks|history|strategy|brief|forecast)/(\d+)/(\d+)$")
OWN_TEAM_PREFIXES = ("picks", "forecast")  # a member's own rows feed the season review, so they stay
PRICE_DAY_NAME = re.compile(r"^price_predictions/(\d{4}-\d{2}-\d{2})$")
PRUNABLE_PATTERNS = ["picks/%", "history/%", "strategy/%", "brief/%", "forecast/%", "price_predictions/%"]


def _now():
    return datetime.now(timezone.utc)


def owner_from_settings(fallback_team_id=None):
    """The one owner to sync when no member has signed up yet, from FPL_TEAM_ID and ALERT_EMAIL_TO.

    An empty list when there's no team id either, so the caller can say
    there's nothing to sync.
    """
    team_id = fallback_team_id or os.environ.get("FPL_TEAM_ID")
    if not team_id:
        return []
    return [{"teamId": int(team_id), "name": None, "email": os.environ.get("ALERT_EMAIL_TO") or None, "role": "owner", "emails": True}]


def active_members_owner_first(rows, fallback_team_id=None):
    """Active member rows in the sync's shape, owner first, or the owner from the settings if there are none."""
    members = [
        {"teamId": row["teamId"], "name": row.get("name"), "email": row.get("email"), "role": row.get("role", "member"),
         "emails": row.get("emails", True)}
        for row in rows if row.get("active", True)
    ]
    members.sort(key=lambda member: member["role"] != "owner")
    return members or owner_from_settings(fallback_team_id)


def is_prunable(name, current_gameweek, today, keep_team_ids):
    """True for a cache name nothing reads any more (see GAMEWEEKS_KEPT and PRICE_PREDICTION_DAYS_KEPT)."""
    weekly = WEEKLY_NAME.match(name)
    if weekly:
        prefix, team_or_entry, gameweek = weekly.group(1), int(weekly.group(2)), int(weekly.group(3))
        if prefix in OWN_TEAM_PREFIXES and team_or_entry in keep_team_ids:
            return False
        return gameweek < current_gameweek - GAMEWEEKS_KEPT
    price_day = PRICE_DAY_NAME.match(name)
    if price_day:
        return date.fromisoformat(price_day.group(1)) < today - timedelta(days=PRICE_PREDICTION_DAYS_KEPT)
    return False


def cache_names_to_prune(names, current_gameweek, today, keep_team_ids=()):
    """The cache names from `names` that the nightly clean-up deletes.

    Rivals' picks and histories, plans (strategy), briefs and forecasts are
    keyed by gameweek, and only recent weeks are read. Price predictions
    are keyed by day. A member's own picks and forecasts are kept, since
    the season review reads every week since their team started.
    """
    keep = set(keep_team_ids)
    return [name for name in names if is_prunable(name, current_gameweek, today, keep)]


def raw_name_from_file(stem):
    """The cache name a FileStorage file was saved under ("raw_picks_1001_12" is "picks/1001/12").

    Saving turns "/" into "_", so names are rebuilt by turning them back;
    "price_predictions" is the one prunable name that has a "_" of its own.
    """
    return stem.removeprefix("raw_").replace("_", "/").replace("price/predictions/", "price_predictions/", 1)


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

    def load_raws(self, prefix):
        """Every response saved with a name starting with `prefix`, in name order."""
        pattern = f"raw_{prefix.replace('/', '_')}*.json"
        return [json.loads(path.read_text()) for path in sorted(self.folder.glob(pattern))]

    def _raw_path(self, name):
        return self.folder / f"raw_{name.replace('/', '_')}.json"

    def prune_cache(self, current_gameweek, today, keep_team_ids=()):
        """Deletes saved responses nothing reads any more (see cache_names_to_prune). Returns how many went."""
        files = {raw_name_from_file(path.stem): path for path in self.folder.glob("raw_*.json")}
        gone = cache_names_to_prune(files, current_gameweek, today, keep_team_ids)
        for name in gone:
            files[name].unlink()
        return len(gone)

    def load_members(self, fallback_team_id=None):
        """Active members, owner first. Locally they're read from members.json, if you add one."""
        path = self.folder / "members.json"
        rows = json.loads(path.read_text()) if path.exists() else []
        return active_members_owner_first(rows, fallback_team_id)

    def start_team_sync(self, team_id):
        """Member runs need the hosted setup, so a local run only notes that it skipped one."""
        log.info("Team %d not synced: member runs only happen with Supabase", team_id)

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

    def alert_was_sent(self, key):
        """True if an alert with this key has gone out before (see alerts.py)."""
        return key in (self.load_raw("alerts-sent") or [])

    def mark_alerts_sent(self, keys):
        self.save_raw("alerts-sent", sorted(set(self.load_raw("alerts-sent") or []) | set(keys)))

    def load_push_subscriptions(self, team_id=None):
        """Devices that turned alerts on. Only the hosted site saves these, so locally there are none."""
        return []

    def load_made_moves(self, team_id, gameweek):
        """Moves marked "Done on FPL" for one gameweek. Locally they're read from made_moves.json, if you add one."""
        path = self.folder / "made_moves.json"
        rows = json.loads(path.read_text()) if path.exists() else []
        return [row for row in rows if row["teamId"] == team_id and row["gameweek"] == gameweek]

    def load_watchlist(self, team_id):
        """Player ids on the website's watchlist. Locally they're read from watchlist.json, if you add one."""
        path = self.folder / "watchlist.json"
        rows = json.loads(path.read_text()) if path.exists() else []
        return [row["playerId"] for row in rows if row["teamId"] == team_id]

    def delete_push_subscription(self, endpoint):
        """Nothing to delete locally: subscriptions only live in Supabase."""

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

    def load_raws(self, prefix):
        """Every response saved with a name starting with `prefix`, in name order."""
        with self.connection.cursor() as cursor:
            cursor.execute("select body from api_cache where path like %s order by path", (prefix.replace("%", r"\%") + "%",))
            return [row[0] for row in cursor.fetchall()]

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

    def alert_was_sent(self, key):
        with self.connection.cursor() as cursor:
            cursor.execute("select 1 from alerts_sent where alert_key = %s", (key,))
            return cursor.fetchone() is not None

    def mark_alerts_sent(self, keys):
        with self.connection.cursor() as cursor:
            cursor.executemany("insert into alerts_sent (alert_key) values (%s) on conflict do nothing", [(key,) for key in keys])

    def load_push_subscriptions(self, team_id=None):
        """Devices that turned alerts on for one team, or every device when `team_id` is None."""
        with self.connection.cursor() as cursor:
            if team_id is None:
                cursor.execute("select subscription from push_subscriptions")
            else:
                cursor.execute("select subscription from push_subscriptions where team_id = %s", (team_id,))
            return [row[0] for row in cursor.fetchall()]

    def load_members(self, fallback_team_id=None):
        """Active members from the members table, owner first, or the owner from the settings if it's empty."""
        with self.connection.cursor() as cursor:
            cursor.execute(
                """select team_id, name, email, role, emails from members
                   where active order by role = 'owner' desc, created_at"""
            )
            rows = cursor.fetchall()
        return active_members_owner_first(
            [{"teamId": row[0], "name": row[1], "email": row[2], "role": row[3], "emails": row[4]} for row in rows],
            fallback_team_id,
        )

    def start_team_sync(self, team_id):
        """Asks for a separate sync of one team, through start_sync in db/member-accounts.sql."""
        self._execute("select public.start_sync(false, %s)", (team_id,))

    def prune_cache(self, current_gameweek, today, keep_team_ids=()):
        """Deletes cache rows nothing reads any more (see cache_names_to_prune) in one statement. Returns how many went."""
        with self.connection.cursor() as cursor:
            cursor.execute("select path from api_cache where path like any(%s)", (PRUNABLE_PATTERNS,))
            names = [row[0] for row in cursor.fetchall()]
        gone = cache_names_to_prune(names, current_gameweek, today, keep_team_ids)
        if gone:
            self._execute("delete from api_cache where path = any(%s)", (gone,))
        return len(gone)

    def delete_push_subscription(self, endpoint):
        self._execute("delete from push_subscriptions where endpoint = %s", (endpoint,))

    def load_made_moves(self, team_id, gameweek):
        """Moves marked "Done on FPL" on the website for one gameweek, oldest first."""
        with self.connection.cursor() as cursor:
            cursor.execute(
                "select gameweek, player_out, player_in, price_in from made_moves where team_id = %s and gameweek = %s order by made_at",
                (team_id, gameweek),
            )
            return [{"gameweek": row[0], "out": row[1], "in": row[2], "priceIn": row[3]} for row in cursor.fetchall()]

    def load_watchlist(self, team_id):
        """Player ids on the website's watchlist (any device), oldest first."""
        with self.connection.cursor() as cursor:
            cursor.execute("select player_id from watchlist where team_id = %s order by added_at", (team_id,))
            return [row[0] for row in cursor.fetchall()]

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
