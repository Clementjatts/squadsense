"""Tests for member teams: who gets synced, one-team runs, per-team alerts
and the nightly cache clean-up.

Run from the jobs/ folder with:  python -m pytest tests/test_members.py
"""

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from squadsense import alerts, sync
from squadsense.fpl_client import FplClient
from squadsense.storage import FileStorage, PostgresStorage, cache_names_to_prune
from tests.sample_data import TEAM_ID, FakeHttpClient, build_sample

MEMBER_ID = 2222
OTHER_MEMBER_ID = 3333


@pytest.fixture(autouse=True)
def quick_sync(monkeypatch):
    """No odds downloads, no chip planning and no local database setting, as in test_squadsense.py."""
    monkeypatch.setattr("squadsense.sync.market_expected_goals", lambda *args, **kwargs: {})
    monkeypatch.setattr("squadsense.strategy.SOLVER_CHIPS", ())
    monkeypatch.setattr("squadsense.strategy.SENSITIVITY_RUNS", 0)
    monkeypatch.delenv("DATABASE_URL", raising=False)


@pytest.fixture(scope="module")
def sample():
    return build_sample()


def write_members(folder, rows):
    """Saves a members.json like the one FileStorage reads."""
    Path(folder).mkdir(parents=True, exist_ok=True)
    (Path(folder) / "members.json").write_text(json.dumps(rows))


def member_row(team_id, role="member", active=True, emails=True, name="Ada"):
    return {"teamId": team_id, "name": name, "email": f"{team_id}@example.com", "role": role, "active": active, "emails": emails}


def owner():
    return {"teamId": TEAM_ID, "name": "Clement", "email": "clement@example.com", "role": "owner", "emails": True}


def member(team_id=MEMBER_ID, emails=True):
    return {"teamId": team_id, "name": "Ada", "email": f"{team_id}@example.com", "role": "member", "emails": emails}


# Members -----------------------------------------------------------------

def test_members_are_active_only_with_the_owner_first(tmp_path):
    write_members(tmp_path, [member_row(MEMBER_ID), member_row(9, active=False), member_row(TEAM_ID, role="owner", name="Clement")])
    members = FileStorage(tmp_path).load_members()
    assert [row["teamId"] for row in members] == [TEAM_ID, MEMBER_ID]
    assert members[0] == {"teamId": TEAM_ID, "name": "Clement", "email": f"{TEAM_ID}@example.com", "role": "owner", "emails": True}


def test_no_members_falls_back_to_the_owner_from_the_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_TEAM_ID", "42")
    monkeypatch.setenv("ALERT_EMAIL_TO", "me@example.com")
    storage = FileStorage(tmp_path)
    assert storage.load_members() == [{"teamId": 42, "name": None, "email": "me@example.com", "role": "owner", "emails": True}]
    assert storage.load_members(fallback_team_id=7)[0]["teamId"] == 7
    monkeypatch.delenv("FPL_TEAM_ID")
    assert storage.load_members() == []


class FakeCursor:
    """Stands in for a psycopg cursor: records each statement and answers from canned rows."""

    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.connection.statements.append((" ".join(sql.split()), params))
        self.rows = next((rows for marker, rows in self.connection.answers.items() if marker in sql), [])

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConnection:
    def __init__(self, answers=None):
        self.answers = answers or {}
        self.statements = []

    def cursor(self):
        return FakeCursor(self)


def postgres_with(answers=None):
    """A PostgresStorage talking to a FakeConnection instead of Supabase."""
    storage = PostgresStorage.__new__(PostgresStorage)
    storage.connection = FakeConnection(answers)
    return storage


def test_postgres_members_come_from_the_members_table(monkeypatch):
    monkeypatch.delenv("FPL_TEAM_ID", raising=False)
    storage = postgres_with({"from members": [(TEAM_ID, "Clement", "c@example.com", "owner", True), (MEMBER_ID, "Ada", "a@example.com", "member", False)]})
    members = storage.load_members()
    assert members[1] == {"teamId": MEMBER_ID, "name": "Ada", "email": "a@example.com", "role": "member", "emails": False}
    sql = storage.connection.statements[0][0]
    assert "where active" in sql and "order by role = 'owner' desc" in sql


def test_postgres_push_subscriptions_are_read_per_team():
    storage = postgres_with({"from push_subscriptions": [({"endpoint": "a"},)]})
    assert storage.load_push_subscriptions(MEMBER_ID) == [{"endpoint": "a"}]
    assert storage.connection.statements[-1] == ("select subscription from push_subscriptions where team_id = %s", (MEMBER_ID,))


def test_postgres_starts_one_member_run_through_start_sync():
    storage = postgres_with()
    storage.start_team_sync(MEMBER_ID)
    assert storage.connection.statements == [("select public.start_sync(false, %s)", (MEMBER_ID,))]


# Regular and one-team runs -------------------------------------------------

def test_regular_run_syncs_the_owner_and_starts_one_run_per_member(tmp_path, sample, monkeypatch):
    folder = tmp_path / "data"
    write_members(folder, [member_row(TEAM_ID, role="owner"), member_row(MEMBER_ID), member_row(OTHER_MEMBER_ID)])
    started = []
    monkeypatch.setattr(FileStorage, "start_team_sync", lambda self, team_id: started.append(team_id))
    client = FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(sample))

    snapshot = sync.run(None, False, folder, None, client=client)

    assert snapshot["team"]["id"] == TEAM_ID
    assert started == [MEMBER_ID, OTHER_MEMBER_ID]
    assert (folder / f"snapshot_{TEAM_ID}.json").exists()
    assert not (folder / f"snapshot_{MEMBER_ID}.json").exists()


def save_shared_data(storage, sample):
    """What a regular run leaves behind: FPL data and every player's history."""
    storage.save_raw("bootstrap-static", sample["bootstrap-static/"])
    storage.save_raw("fixtures", sample["fixtures/"])
    for player in sample["bootstrap-static/"]["elements"]:
        summary = sample[f"element-summary/{player['id']}/"]
        storage.save_player_history(player["id"], summary["history"])
        storage.save_player_past(player["id"], summary["history_past"])


def test_member_run_uses_the_saved_shared_data(tmp_path, sample):
    folder = tmp_path / "data"
    write_members(folder, [member_row(TEAM_ID, role="member")])
    save_shared_data(FileStorage(folder), sample)
    fake_http = FakeHttpClient(sample)

    snapshot = sync.run_member(TEAM_ID, folder, None, client=FplClient(min_seconds_between_requests=0, http_client=fake_http))

    assert snapshot["gameweek"] == 13 and len(snapshot["squad"]) == 15
    shared_paths = ("bootstrap-static/", "fixtures/", "element-summary/")
    assert not any(path.startswith(shared_paths) for path in fake_http.requested)
    assert (folder / f"snapshot_{TEAM_ID}.json").exists()
    assert not (folder / "price_snapshots.jsonl").exists()  # shared rows are left alone


def test_member_run_without_saved_data_stops_with_a_message(tmp_path):
    write_members(tmp_path, [member_row(MEMBER_ID)])
    with pytest.raises(SystemExit, match="regular sync"):
        sync.run_member(MEMBER_ID, tmp_path, None, client=FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient({})))


def test_member_run_for_a_team_that_is_not_a_member_fails(tmp_path, sample):
    write_members(tmp_path, [member_row(MEMBER_ID, active=False)])
    save_shared_data(FileStorage(tmp_path), sample)
    with pytest.raises(sync.TeamSyncFailed) as failure:
        sync.run_member(MEMBER_ID, tmp_path, None, client=FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(sample)))
    assert failure.value.team_ids == [MEMBER_ID]


def test_one_team_failing_does_not_stop_the_others(tmp_path, sample, monkeypatch):
    folder = tmp_path / "data"
    write_members(folder, [member_row(TEAM_ID, role="owner"), member_row(MEMBER_ID), member_row(OTHER_MEMBER_ID)])
    broken = {path: body for path, body in sample.items() if not path.startswith(f"entry/{TEAM_ID}/")}
    started = []

    def start_team_sync(self, team_id):
        if team_id == MEMBER_ID:
            raise RuntimeError("GitHub refused the request")
        started.append(team_id)

    monkeypatch.setattr(FileStorage, "start_team_sync", start_team_sync)
    with pytest.raises(sync.TeamSyncFailed) as failure:
        sync.run(None, False, folder, None, client=FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(broken)))

    assert failure.value.team_ids == [TEAM_ID, MEMBER_ID]
    assert started == [OTHER_MEMBER_ID]
    assert FileStorage(folder).load_raw("bootstrap-static") is not None  # the shared stage still ran


def test_main_exits_non_zero_when_a_team_failed(monkeypatch):
    def failing_run(*args, **kwargs):
        raise sync.TeamSyncFailed([MEMBER_ID])

    monkeypatch.setattr(sync, "run", failing_run)
    monkeypatch.setattr("sys.argv", ["squadsense.sync", "--team-id", str(TEAM_ID)])
    with pytest.raises(SystemExit) as exit_info:
        sync.main()
    assert exit_info.value.code == 1


def test_main_runs_one_team_with_member_team(monkeypatch):
    calls = []
    monkeypatch.setattr(sync, "run_member", lambda team_id, *args, **kwargs: calls.append(team_id))
    monkeypatch.setattr("sys.argv", ["squadsense.sync", "--member-team", str(MEMBER_ID)])
    sync.main()
    assert calls == [MEMBER_ID]


# Alerts per team -------------------------------------------------------------

def alert_snapshot(team_id=TEAM_ID, **overrides):
    snapshot = {
        "team": {"id": team_id}, "gameweek": 12, "deadline": "2026-11-27T18:30:00Z", "squad": [1, 2],
        "players": {"1": {"name": "Haaland", "news": "", "yellowCards": 1}, "2": {"name": "Saka", "news": "Knock - 75% chance of playing", "yellowCards": 1},
                    "3": {"name": "Palmer", "news": ""}},
        "captainOptions": [{"playerId": 1}], "priceWatch": {"atRisk": [2], "players": []}, "flags": [],
        "solverPlan": {"weeks": [{"moves": [{"out": 2, "in": 3}], "chip": None}]}, "changes": [],
        "ruleChanges": ["Points for a MID goal: 5 now 6"],
    }
    snapshot.update(overrides)
    return snapshot


class FakeResend:
    """Stands in for httpx.Client: records every email instead of sending it."""

    def __init__(self):
        self.sent = []

    def post(self, url, headers, json):
        self.sent.append(json)
        return type("Response", (), {"status_code": 200, "text": "ok"})()


NIGHT = datetime(2026, 11, 27, 22, 15, tzinfo=timezone.utc)
EMAIL_ONLY = alerts.Channels(resend_key="test", email_to="clement@example.com")


def test_alert_keys_carry_the_team_id(tmp_path):
    storage = FileStorage(tmp_path)
    alerts.run_alerts(storage, alert_snapshot(), owner(), EMAIL_ONLY, FakeResend(), NIGHT)
    assert storage.alert_was_sent(f"{TEAM_ID}:price-2026-11-27-2")
    assert storage.alert_was_sent(f"{TEAM_ID}:alerts-primed")
    assert not storage.alert_was_sent("price-2026-11-27-2")


def test_member_email_goes_to_their_address_with_the_owner_as_reply_to(tmp_path):
    resend = FakeResend()
    sent = alerts.run_alerts(FileStorage(tmp_path), alert_snapshot(MEMBER_ID), member(), EMAIL_ONLY, resend, NIGHT)
    assert sent == ["Price drop likely tonight"]  # no rules alert: that one is the owner's only
    assert resend.sent[0]["to"] == [f"{MEMBER_ID}@example.com"]
    assert resend.sent[0]["reply_to"] == "clement@example.com"


def test_rules_alert_goes_to_the_owner(tmp_path):
    sent = alerts.run_alerts(FileStorage(tmp_path), alert_snapshot(), owner(), EMAIL_ONLY, FakeResend(), NIGHT)
    assert "FPL changed its rules" in sent


def test_no_email_when_a_member_switched_emails_off(tmp_path):
    resend = FakeResend()
    assert alerts.run_alerts(FileStorage(tmp_path), alert_snapshot(MEMBER_ID), member(emails=False), EMAIL_ONLY, resend, NIGHT) == []
    assert resend.sent == []


def test_one_teams_alert_does_not_block_another_teams(tmp_path):
    storage = FileStorage(tmp_path)
    alerts.run_alerts(storage, alert_snapshot(), owner(), EMAIL_ONLY, FakeResend(), NIGHT)
    assert alerts.run_alerts(storage, alert_snapshot(MEMBER_ID), member(), EMAIL_ONLY, FakeResend(), NIGHT) == ["Price drop likely tonight"]


def test_first_run_priming_happens_per_team(tmp_path):
    storage = FileStorage(tmp_path)
    alerts.run_alerts(storage, alert_snapshot(), owner(), EMAIL_ONLY, FakeResend(), NIGHT)
    # The owner is primed already, but a new member's old injury news is still only recorded.
    resend = FakeResend()
    alerts.run_alerts(storage, alert_snapshot(MEMBER_ID), member(), EMAIL_ONLY, resend, NIGHT)
    assert not any("injury news" in email["subject"] for email in resend.sent)
    assert storage.alert_was_sent(f"{MEMBER_ID}:news-2-{alerts.short_hash('Knock - 75% chance of playing')}")


class PushStorage(FileStorage):
    """FileStorage with one saved device per team, recording which team's devices were asked for."""

    def __init__(self, folder):
        super().__init__(folder)
        self.asked_for = []

    def load_push_subscriptions(self, team_id=None):
        self.asked_for.append(team_id)
        return [{"endpoint": f"device-{team_id}"}]


def test_push_goes_only_to_that_teams_devices(tmp_path, monkeypatch):
    import pywebpush
    pushed = []
    monkeypatch.setattr(pywebpush, "webpush", lambda subscription, payload, **kwargs: pushed.append(subscription["endpoint"]))
    storage = PushStorage(tmp_path)
    channels = alerts.Channels(vapid_private_key="key", vapid_subject="mailto:me@example.com")
    alerts.run_alerts(storage, alert_snapshot(MEMBER_ID), member(), channels, FakeResend(), NIGHT)
    assert set(storage.asked_for) == {MEMBER_ID}
    assert pushed and set(pushed) == {f"device-{MEMBER_ID}"}


def test_test_alert_pushes_to_the_owners_devices(tmp_path, monkeypatch):
    import pywebpush
    monkeypatch.setattr(pywebpush, "webpush", lambda subscription, payload, **kwargs: None)
    write_members(tmp_path, [member_row(TEAM_ID, role="owner"), member_row(MEMBER_ID)])
    storage = PushStorage(tmp_path)
    alerts.send_test_alert(storage, alerts.Channels(vapid_private_key="key", vapid_subject="mailto:me@example.com"), FakeResend())
    assert storage.asked_for and set(storage.asked_for) == {TEAM_ID}


def test_email_footer_says_how_to_switch_emails_off():
    from squadsense.email_template import render_email
    alert = alerts.Alert([], "Test alert", "Alerts are working.", "/")
    html, text = render_email(alert, "https://example.com", NIGHT)
    assert "bell menu" in html and "bell menu" in text


# Cache clean-up ----------------------------------------------------------------

def test_cache_clean_up_picks_old_weeks_and_old_price_days():
    names = [
        "picks/1001/8", "picks/1001/9", "history/1001/5", "strategy/42/8", "brief/42/12", "forecast/1001/2",
        "picks/42/2", "forecast/42/2",  # a member's own picks and forecasts feed the season review
        "price_predictions/2026-10-25", "price_predictions/2026-10-26",
        "bootstrap-static", "standings/555", "changes/42", "alerts-sent",
    ]
    gone = cache_names_to_prune(names, current_gameweek=12, today=date(2026, 11, 25), keep_team_ids=[42])
    assert sorted(gone) == ["forecast/1001/2", "history/1001/5", "picks/1001/8", "price_predictions/2026-10-25", "strategy/42/8"]


def test_file_storage_prunes_old_cache_files(tmp_path):
    storage = FileStorage(tmp_path)
    for name in ("picks/1001/2", "picks/1001/12", "price_predictions/2026-01-01", "price_predictions/2026-11-24", "bootstrap-static"):
        storage.save_raw(name, {"name": name})
    assert storage.prune_cache(12, date(2026, 11, 25), keep_team_ids=[]) == 2
    assert storage.load_raw("picks/1001/2") is None and storage.load_raw("price_predictions/2026-01-01") is None
    assert storage.load_raw("picks/1001/12") and storage.load_raw("price_predictions/2026-11-24") and storage.load_raw("bootstrap-static")


def test_postgres_prunes_with_one_delete():
    storage = postgres_with({"select path from api_cache": [("picks/1001/2",), ("picks/1001/12",)]})
    assert storage.prune_cache(12, date(2026, 11, 25), keep_team_ids=[]) == 1
    assert storage.connection.statements[-1] == ("delete from api_cache where path = any(%s)", (["picks/1001/2"],))


def test_full_run_cleans_the_cache_and_a_regular_run_does_not(tmp_path, sample, monkeypatch):
    calls = []
    monkeypatch.setattr(FileStorage, "prune_cache", lambda self, week, today, keep_team_ids: calls.append((week, keep_team_ids)) or 0)
    monkeypatch.setattr(sync, "run_team", lambda *args, **kwargs: {})  # only the clean-up matters here
    client = FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(sample))
    sync.run(TEAM_ID, False, tmp_path, None, client=client)
    assert calls == []
    sync.run(TEAM_ID, True, tmp_path, None, client=client)
    assert calls == [(12, [TEAM_ID])]


# Workflow ----------------------------------------------------------------------

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sync.yml"


def test_workflow_takes_a_team_and_runs_it_on_its_own():
    text = WORKFLOW.read_text()
    assert "      team:\n" in text and "type: string" in text
    assert "group: sync-${{ inputs.team || 'all' }}" in text
    assert "cancel-in-progress: false" in text
    assert 'python -m squadsense.sync --member-team "$TEAM"' in text
    assert "TEAM: ${{ inputs.team }}" in text
