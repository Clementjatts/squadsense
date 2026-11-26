"""Tests for "This week's exposure" on the Leagues page: effective ownership
before the deadline, from rivals' last lineups against your planned team.

Run from the jobs/ folder with:  python -m pytest tests/test_exposure.py
"""

from squadsense import leagues
from tests.sample_data import TEAM_ID


def lineup(starters, captain, bench=(), chip=None):
    """A rival's picks: `starters` in positions 1 to 11, `bench` after them."""
    picks = [{"element": player, "position": slot + 1, "is_captain": player == captain} for slot, player in enumerate(starters)]
    picks += [{"element": player, "position": 12 + slot, "is_captain": False} for slot, player in enumerate(bench)]
    return {"picks": picks, "active_chip": chip}


XP = {1: 6.0, 2: 4.0, 3: 5.0, 4: 2.0, 9: 3.0}
next_xp = lambda player: XP.get(player, 0.0)


def line_for(result, player):
    return next(line for line in result["costing"] + result["gaining"] if line["playerId"] == player)


def test_captains_count_twice_and_benches_not_at_all():
    rivals = [lineup([1, 2], captain=1, bench=[3]), lineup([1, 3], captain=3)]
    result = leagues.league_exposure(rivals, {2: 1}, next_xp)
    player_1 = line_for(result, 1)
    assert player_1["eo"] == 1.5  # captained by one rival, started by the other
    assert player_1["owned"] == 1.0 and player_1["captained"] == 0.5
    assert line_for(result, 3)["eo"] == 1.0  # benched by one rival, captained by the other


def test_swing_is_your_share_minus_theirs_times_xp():
    rivals = [lineup([1], captain=1), lineup([1], captain=1)]
    result = leagues.league_exposure(rivals, {1: 1, 9: 2}, next_xp)
    assert line_for(result, 1)["swing"] == -6.0  # you start him once, they captain him: (1 - 2) x 6
    assert line_for(result, 9)["swing"] == 6.0  # your differential captain: (2 - 0) x 3
    assert result["swing"] == 0.0 and result["rivals"] == 2


def test_lists_split_by_sign_and_sort_biggest_first():
    rivals = [lineup([1, 2, 4], captain=1)]
    result = leagues.league_exposure(rivals, {3: 2}, next_xp)
    assert [line["playerId"] for line in result["costing"]] == [1, 2, 4]
    assert [line["playerId"] for line in result["gaining"]] == [3]


def test_players_owned_equally_are_left_out():
    result = leagues.league_exposure([lineup([1], captain=1)], {1: 2}, next_xp)
    assert result["costing"] == [] and result["gaining"] == []


def test_one_off_chips_count_as_a_normal_week():
    triple = lineup([1], captain=1, chip="3xc")
    bench_boost = lineup([2], captain=2, bench=[3], chip="bboost")
    free_hit = lineup([4], captain=4, chip="freehit")
    result = leagues.league_exposure([triple, bench_boost, free_hit], {}, next_xp)
    assert result["rivals"] == 2  # the Free Hit squad is gone, so that rival is left out
    assert line_for(result, 1)["eo"] == 1.0  # a Triple Captain counts as a normal captain
    assert all(line["playerId"] not in (3, 4) for line in result["costing"])


def test_no_rivals_means_nothing_to_show():
    assert leagues.league_exposure([], {1: 2}, next_xp) == {"rivals": 0, "swing": 0.0, "costing": [], "gaining": []}


def test_lists_stop_at_six():
    rivals = [lineup(list(range(100, 111)), captain=100)]
    result = leagues.league_exposure(rivals, {}, lambda player: 1.0)
    assert len(result["costing"]) == leagues.EXPOSURE_SHOWN == 6


def rows(ranks):
    return [{"entry": 5000 + rank, "rank": rank, "entry_name": f"Team {rank}", "total": 1000 - rank, "event_total": 50} for rank in ranks]


def test_a_big_league_has_top_ten_and_around_you_groups():
    standings = rows(range(1, 51))
    standings[29]["entry"] = TEAM_ID  # you're 30th
    picks = {row["entry"]: lineup([row["rank"]], captain=row["rank"]) for row in standings if row["entry"] != TEAM_ID}
    league = {"info": {"id": 1, "name": "Big", "entry_rank": 30}, "kind": "table", "standings": standings, "picks": picks}
    groups = leagues.exposure_groups(league, TEAM_ID, {}, lambda player: 1.0)
    assert [group["key"] for group in groups] == ["top", "around"]
    assert groups[0]["rivals"] == 10 and groups[1]["rivals"] == 20


def test_a_small_league_is_one_group_of_everyone():
    standings = rows(range(1, 4))
    picks = {row["entry"]: lineup([1], captain=1) for row in standings}
    league = {"info": {"id": 1, "name": "Small"}, "kind": "full", "standings": standings, "picks": picks}
    groups = leagues.exposure_groups(league, TEAM_ID, {}, next_xp)
    assert [(group["key"], group["label"], group["rivals"]) for group in groups] == [("all", "Everyone", 3)]
