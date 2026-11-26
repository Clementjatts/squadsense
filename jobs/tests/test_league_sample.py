"""Tests for big leagues: reading a sample of rivals' picks, and where you stand in every league.

Run from the jobs/ folder with:  python -m pytest tests/test_league_sample.py
"""

from squadsense import leagues
from squadsense.storage import FileStorage
from tests.sample_data import TEAM_ID
from tests.test_squadsense import FakeLeagueClient, league_entry


def rows_for(ranks):
    """Table rows for the given ranks, team 5000 + rank at each, 10 points apart."""
    return [{"entry": 5000 + rank, "rank": rank, "entry_name": f"Team {rank}", "total": 1000 - rank * 10} for rank in ranks]


def test_sample_is_the_top_ten_and_ten_either_side_of_you():
    standings = rows_for(list(range(1, 51)) + list(range(201, 251)))
    entries = leagues.sample_entries(standings, my_rank=230, my_team_id=TEAM_ID)
    assert sorted(entries) == [5000 + rank for rank in list(range(1, 11)) + list(range(220, 230)) + list(range(231, 241))]


def test_sample_near_the_top_has_no_repeats_and_leaves_you_out():
    standings = rows_for(range(1, 51))
    standings[4]["entry"] = TEAM_ID  # you're 5th
    entries = leagues.sample_entries(standings, my_rank=5, my_team_id=TEAM_ID)
    assert len(entries) == len(set(entries)) == 14  # ranks 1 to 15, minus you
    assert TEAM_ID not in entries


def test_big_leagues_read_the_sample_of_picks(tmp_path):
    fetched = leagues.fetch_leagues(FakeLeagueClient({3: 500}), FileStorage(tmp_path), league_entry((3, 500, 230)), 12, today="2026-11-22")
    assert fetched[0]["kind"] == "table"
    assert len(fetched[0]["picks"]) == 30
    summary = leagues.build_leagues(fetched, TEAM_ID, [], {}, 13, (1, 19))[0]
    assert summary["picksFrom"] == "sample" and summary["rivalsWithPicks"] == 30


def test_small_leagues_say_their_picks_are_from_every_rival(tmp_path):
    fetched = leagues.fetch_leagues(FakeLeagueClient({1: 10}), FileStorage(tmp_path), league_entry((1, 10, 4)), 12, today="2026-11-22")
    assert leagues.build_leagues(fetched, TEAM_ID, [], {}, 13, (1, 19))[0]["picksFrom"] == "all"


def test_where_you_stand_gives_the_gaps_to_the_leader_and_your_neighbours():
    table = [{"entry": 1, "teamName": "Top", "rank": 1, "total": 700},
             {"entry": 2, "teamName": "Above", "rank": 2, "total": 650},
             {"entry": TEAM_ID, "teamName": "Me", "rank": 3, "total": 640},
             {"entry": 4, "teamName": "Below", "rank": 4, "total": 600}]
    assert leagues.standing(table, TEAM_ID) == {
        "leaderGap": 60, "above": {"teamName": "Above", "gap": 10}, "below": {"teamName": "Below", "gap": 40},
    }


def test_where_you_stand_at_the_top_has_no_team_above():
    table = [{"entry": TEAM_ID, "teamName": "Me", "rank": 1, "total": 700}, {"entry": 2, "teamName": "Next", "rank": 2, "total": 690}]
    assert leagues.standing(table, TEAM_ID) == {"leaderGap": 0, "above": None, "below": {"teamName": "Next", "gap": 10}}


def test_where_you_stand_is_none_when_you_are_not_in_the_table():
    assert leagues.standing([{"entry": 2, "teamName": "X", "rank": 1, "total": 9}], TEAM_ID) is None


def big_league(my_rank, ranks):
    """A big league as fetch_big_league returns it: standings for `ranks`, you at `my_rank`, picks for the sample."""
    standings = [dict(row, event_total=40) for row in rows_for(ranks)]
    for row in standings:
        if row["rank"] == my_rank:
            row["entry"] = TEAM_ID
    sample = leagues.sample_entries(standings, my_rank, TEAM_ID)
    picks = {entry: {"picks": [{"element": entry}], "active_chip": None} for entry in sample}
    return {"info": {"id": 9, "name": "Big", "entry_rank": my_rank, "rank_count": 5000}, "kind": "table", "standings": standings, "picks": picks, "histories": {}}


MY_PICKS = {"picks": [{"element": 1}], "active_chip": None}


def test_live_entry_for_a_big_league_is_the_sample_in_two_groups():
    league = leagues.live_league(big_league(230, list(range(1, 51)) + list(range(201, 251))), TEAM_ID, MY_PICKS)
    assert league["kind"] == "sample" and league["size"] == 5000
    groups = {team["entry"]: team["groups"] for team in league["teams"]}
    assert len(groups) == 31  # 10 leaders, 10 teams either side of you, and you
    assert groups[5001] == ["top"] and groups[5225] == ["around"]
    assert groups[TEAM_ID] == ["top", "around"]  # you're compared with both groups
    mine = next(team for team in league["teams"] if team["entry"] == TEAM_ID)
    assert mine["picks"] == MY_PICKS["picks"] and mine["rank"] == 230 and mine["totalBefore"] == 1000 - 2300 - 40


def test_a_team_near_the_top_is_in_both_groups():
    league = leagues.live_league(big_league(5, list(range(1, 51))), TEAM_ID, MY_PICKS)
    groups = {team["entry"]: team["groups"] for team in league["teams"]}
    assert groups[5003] == ["top", "around"] and groups[5012] == ["around"]


def test_live_entry_for_a_small_league_keeps_every_team():
    standings = [dict(row, event_total=40) for row in rows_for(range(1, 6))]
    standings[2]["entry"] = TEAM_ID
    picks = {row["entry"]: {"picks": [{"element": 2}], "active_chip": "bboost"} for row in standings if row["entry"] != TEAM_ID}
    league = leagues.live_league({"info": {"id": 3, "name": "Small", "rank_count": 5}, "kind": "full", "standings": standings, "picks": picks, "histories": {}}, TEAM_ID, MY_PICKS)
    assert league["kind"] == "full" and len(league["teams"]) == 5
    assert all("groups" not in team for team in league["teams"])
    assert next(team for team in league["teams"] if team["entry"] == 5001)["chip"] == "bboost"
