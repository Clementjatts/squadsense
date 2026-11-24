"""Tests for correcting the captain haul and blank chances from history.

Run from the jobs/ folder with:  python -m pytest tests/test_captain_odds.py
"""

import random

import pytest

from squadsense.captain_calibration import CaptainCall, cross_validate, fit_platt
from squadsense.captaincy import calibrate


def test_calibrate_with_neutral_numbers_changes_nothing():
    assert calibrate(0.3, (0.0, 1.0)) == pytest.approx(0.3)


def test_calibrate_pulls_overconfident_chances_in():
    # b below 1 squeezes chances towards the middle, as the haul chance needs.
    assert calibrate(0.65, (-0.5, 0.5)) < 0.5


def test_calibrate_keeps_the_order_of_the_options():
    numbers = (-0.4, 0.6)
    assert calibrate(0.1, numbers) < calibrate(0.3, numbers) < calibrate(0.8, numbers)


def test_calibrate_handles_certain_chances():
    # A raw 0% or 100% would break the logit, so it's clamped first.
    numbers = (0.0, 0.5)
    assert 0 < calibrate(0.0, numbers) < calibrate(1.0, numbers) < 1


def test_fit_platt_recovers_known_numbers():
    rng = random.Random(1)
    chances = [rng.uniform(0.02, 0.9) for _ in range(4000)]
    outcomes = [int(rng.random() < calibrate(chance, (-0.6, 0.5))) for chance in chances]
    a, b = fit_platt(chances, outcomes)
    assert a == pytest.approx(-0.6, abs=0.15)
    assert b == pytest.approx(0.5, abs=0.1)


def test_cross_validate_scores_each_season_on_numbers_fitted_without_it():
    rng = random.Random(2)
    calls = []
    for season in ("A", "B", "C"):
        for _ in range(600):
            raw = rng.uniform(0.02, 0.9)
            hauled = rng.random() < calibrate(raw, (-0.6, 0.5))
            calls.append(CaptainCall(season, 1, raw, 0.3, 12 if hauled else 4))
    rows = cross_validate(calls, "haul")
    assert [row["season"] for row in rows] == ["A", "B", "C"]
    for row in rows:
        # Overconfident raw chances: the correction beats both the raw chance and a flat guess.
        assert row["corrected"] < row["raw"]
        assert row["corrected"] < row["flat"]
