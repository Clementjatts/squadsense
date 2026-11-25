"""Tests for availability by match: FPL's flag only covers the next gameweek,
so later matches use the return date in the news, or the kind of absence.

Run from the jobs/ folder with:  python -m pytest tests/test_availability.py
"""

from datetime import date

from squadsense.availability import match_availability, return_date
from squadsense.fixtures import FixtureModel
from squadsense.model import PlayerRates, expected_points_for_week


def player(status, chance, news=""):
    return {"id": 9, "element_type": 3, "team": 1, "status": status, "chance_of_playing_next_round": chance, "news": news}


def match(kickoff):
    return {"opponent": 2, "is_home": True, "fpl_difficulty": 3, "kickoff": kickoff}


def test_return_date_reads_expected_back_and_suspended_until():
    assert return_date("Thigh injury - Expected back 20 Dec", "2026-11-28T15:00:00Z") == date(2026, 12, 20)
    assert return_date("Suspended until 5 Dec", "2026-11-28T15:00:00Z") == date(2026, 12, 5)


def test_return_date_moves_into_next_year_across_new_year():
    assert return_date("Hamstring injury - Expected back 2 Jan", "2026-12-20T15:00:00Z") == date(2027, 1, 2)


def test_return_date_is_none_without_a_date():
    assert return_date("Back injury - Unknown return date", "2026-11-28T15:00:00Z") is None
    assert return_date("", "2026-11-28T15:00:00Z") is None


def test_the_next_gameweek_keeps_fpls_own_flag():
    assert match_availability(player("d", 75, "Knock - 75% chance of playing"), match("2026-11-28T15:00:00Z"), later_week=False) == 0.75
    assert match_availability(player("a", None), match("2026-11-28T15:00:00Z"), later_week=False) == 1.0


def test_a_suspension_with_a_date_ends_on_that_date():
    banned = player("s", 0, "Suspended until 2 Dec")
    assert match_availability(banned, match("2026-11-30T15:00:00Z"), later_week=True) == 0.0
    assert match_availability(banned, match("2026-12-03T19:30:00Z"), later_week=True) == 1.0


def test_an_injury_with_a_date_is_out_before_it_and_back_after():
    injured = player("i", 0, "Thigh injury - Expected back 20 Dec")
    assert match_availability(injured, match("2026-12-13T15:00:00Z"), later_week=True) == 0.0
    assert match_availability(injured, match("2026-12-20T15:00:00Z"), later_week=True) == 1.0


def test_a_ban_without_a_date_lasts_one_match():
    assert match_availability(player("s", 0, "Suspended"), match("2026-12-03T19:30:00Z"), later_week=True) == 1.0


def test_doubtful_only_affects_the_next_gameweek():
    assert match_availability(player("d", 50, "Knock - 50% chance of playing"), match("2026-12-03T19:30:00Z"), later_week=True) == 1.0


def test_unknown_return_and_departed_players_stay_out():
    assert match_availability(player("i", 0, "Back injury - Unknown return date"), match("2026-12-03T19:30:00Z"), later_week=True) == 0.0
    assert match_availability(player("u", 0, "Has joined Getafe permanently"), match("2026-12-03T19:30:00Z"), later_week=True) == 0.0


def test_a_flag_without_a_status_is_read_from_the_chance():
    # Past seasons and test data have no status: 0% reads as injured, any other chance as doubtful.
    assert match_availability(player(None, 0), match("2026-12-03T19:30:00Z"), later_week=True) == 0.0
    assert match_availability(player(None, 75), match("2026-12-03T19:30:00Z"), later_week=True) == 1.0


def test_a_banned_player_scores_again_in_the_week_after_his_ban():
    fit = PlayerRates(xg_per_90=0.3, xa_per_90=0.2, bonus_per_90=0.4, saves_per_90=0.0, defensive_contribution_rate=0.2,
                      chance_60_minutes=0.0, chance_under_60=0.0, recent_points_per_match=5.0,
                      fit_chance_60=0.9, fit_chance_under_60=0.05)
    banned = player("s", 0, "Suspended until 2 Dec")
    model = FixtureModel({1: {"attack": 1.0, "concede": 1.0}, 2: {"attack": 1.0, "concede": 1.0}})
    next_week = expected_points_for_week(banned, fit, [match("2026-11-29T15:00:00Z")], model)
    later_week = expected_points_for_week(banned, fit, [match("2026-12-03T19:30:00Z")], model, later_week=True)
    assert next_week == 0.0
    assert later_week > 3.0
