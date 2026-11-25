"""Tests for the watchlist: loading it from local storage and the
"Watched player likely to rise tonight" alert.

Run from the jobs/ folder with:  python -m pytest tests/test_watchlist.py
"""

import json
from datetime import datetime, timezone

from squadsense.alerts import collect, watch_rise_alert
from squadsense.storage import FileStorage

NIGHT = datetime(2026, 11, 27, 22, 15, tzinfo=timezone.utc)


def row(player_id, likelihood, in_squad=False, locked_until=None):
    """One Price Watch row with only the fields the alert reads."""
    return {"id": player_id, "likelihood": likelihood, "lockedUntil": locked_until, "inSquad": in_squad}


def watch_snapshot():
    """Palmer (3) rises tonight, Isak (4) only might, Saka (2) is owned and rises tonight."""
    return {
        "squad": [1, 2],
        "players": {"1": {"name": "Haaland"}, "2": {"name": "Saka"}, "3": {"name": "Palmer"}, "4": {"name": "Isak"},
                    "5": {"name": "Wood"}},
        "priceWatch": {"players": [row(2, 5, in_squad=True), row(3, 5), row(4, 3), row(5, 5, locked_until="2026-11-28")]},
    }


def test_watched_player_rising_tonight_gets_one_alert_per_night():
    alerts = watch_rise_alert(watch_snapshot(), NIGHT, [3, 4])
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert.title == "Watched player likely to rise tonight"
    assert alert.keys == ["watch-2026-11-27-3"]  # Isak's band 3 isn't the TONIGHT band
    assert alert.path == "/prices"
    assert "Palmer" in alert.body and "00:00 UK" in alert.body and "£0.1m" in alert.body
    next_night = watch_rise_alert(watch_snapshot(), datetime(2026, 11, 28, 22, 15, tzinfo=timezone.utc), [3])
    assert next_night[0].keys == ["watch-2026-11-28-3"]


def test_squad_players_and_locked_prices_are_left_out():
    assert watch_rise_alert(watch_snapshot(), NIGHT, [2, 5]) == []


def test_empty_watchlist_means_no_alert():
    assert watch_rise_alert(watch_snapshot(), NIGHT, []) == []


def test_file_storage_reads_the_watchlist_for_one_team(tmp_path):
    storage = FileStorage(tmp_path)
    assert storage.load_watchlist(7) == []
    rows = [{"teamId": 7, "playerId": 3}, {"teamId": 8, "playerId": 4}, {"teamId": 7, "playerId": 9}]
    (tmp_path / "watchlist.json").write_text(json.dumps(rows))
    assert storage.load_watchlist(7) == [3, 9]


def test_collect_reads_the_watchlist_from_storage(tmp_path):
    storage = FileStorage(tmp_path)
    (tmp_path / "watchlist.json").write_text(json.dumps([{"teamId": 7, "playerId": 3}]))
    snapshot = {**watch_snapshot(), "team": {"id": 7}, "gameweek": 12, "deadline": "2026-12-05T11:00:00Z",
                "flags": [], "solverPlan": None}
    snapshot["priceWatch"]["atRisk"] = []
    titles = [alert.title for alert in collect(snapshot, NIGHT, storage, is_owner=True)]
    assert "Watched player likely to rise tonight" in titles
