"""Tests for the review's points source: FPL's final points for the whole
week, so "Across FPL" shows the real top scorers, not only players whose
saved history happened to be up to date.

Run from the jobs/ folder with:  python -m pytest tests/test_review_points.py
"""

from squadsense import review


def live(*players):
    """An event/{gw}/live/ answer with the given (player id, points) pairs."""
    return {"elements": [{"id": player_id, "stats": {"total_points": points}} for player_id, points in players]}


BOOTSTRAP = {"events": [{"id": 11, "finished": True, "data_checked": True, "average_entry_score": 35,
                         "highest_score": 106, "most_captained": 3}]}


def test_live_points_read_every_player():
    assert review.live_week_points(live((1, 4), (2, 15), (3, 2))) == {1: 4, 2: 15, 3: 2}


def test_top_scorers_come_from_fpls_points_when_given():
    # Saved histories only know players 1 and 3; FPL's live data knows the real top scorer, player 2.
    histories = {1: [{"round": 11, "total_points": 4}], 3: [{"round": 11, "total_points": 2}]}
    result = review.build_review(BOOTSTRAP, histories, None, None, None, live_points={1: 4, 2: 15, 3: 2})
    assert [line["playerId"] for line in result["topPlayers"]][:2] == [2, 1]
    assert result["mostCaptained"] == {"playerId": 3, "points": 2}


def test_histories_are_used_when_fpls_points_are_missing():
    histories = {1: [{"round": 11, "total_points": 4}]}
    result = review.build_review(BOOTSTRAP, histories, None, None, None)
    assert result["topPlayers"] == [{"playerId": 1, "points": 4}]


def picks_with_bench_boost():
    """GW picks in FPL's shape: positions 1-11 start, 12-15 are the bench; Bench Boost gives the bench multiplier 1."""
    rows = [{"element": 100 + position, "position": position, "multiplier": 1, "is_captain": position == 11,
             "is_vice_captain": position == 10} for position in range(1, 16)]
    rows[10]["multiplier"] = 2
    return {"picks": rows, "active_chip": "bboost"}


HISTORY_ROW = {"event": 11, "points": 58, "event_transfers_cost": 0, "points_on_bench": 21, "overall_rank": 5}


def test_bench_boost_week_keeps_the_bench_apart_from_the_starters():
    points = {100 + position: position for position in range(1, 16)}
    team = review.team_week(picks_with_bench_boost(), HISTORY_ROW, None, points, None)
    assert [line["playerId"] for line in team["starters"]] == list(range(101, 112))
    assert [line["playerId"] for line in team["bench"]] == [112, 113, 114, 115]
    assert team["viceCaptain"] == 110


def test_best_captain_is_chosen_from_the_starting_eleven_only():
    # The bench's player 115 scored most, but he wasn't in the starting eleven.
    points = {100 + position: position for position in range(1, 16)}
    team = review.team_week(picks_with_bench_boost(), HISTORY_ROW, None, points, None)
    assert team["bestCaptain"]["playerId"] == 111


def test_the_bench_is_included_in_the_snapshot_players():
    points = {100 + position: position for position in range(1, 16)}
    team = review.team_week(picks_with_bench_boost(), HISTORY_ROW, None, points, None)
    found = review.players_mentioned({"topPlayers": [], "mostCaptained": None, "team": team})
    assert {112, 113, 114, 115} <= found
