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
