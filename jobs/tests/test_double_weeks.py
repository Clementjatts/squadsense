"""Double gameweeks in chip timing: Bench Boost and Triple Captain keep values (strategy.py)."""

from types import SimpleNamespace

import pytest

from squadsense import strategy
from squadsense.chips import ChipValue

WINDOW_END = 15  # the five-week plan covers GW11-15; keep values look at GW16 onwards


CHIP_WEEKS = {"bboost": (16, 17), "3xc": (18, 19), "freehit": (16, 17), "wildcard": (18, 19)}


def chip_values():
    """Every chip worth 10 points in its two later weeks, with player 1 as Triple Captain's captain.

    Bench Boost and Triple Captain get weeks of their own, so sharing weeks out never moves them.
    """
    values = {}
    for chip, weeks in CHIP_WEEKS.items():
        risk = {"captainId": 1} if chip == "3xc" else {}
        values[chip] = {week: ChipValue(10.0, "test", risk) for week in weeks}
    return values


def squad_context(doubles=()):
    """A two-player squad whose club (team 1) plays twice in each week of `doubles`, and once in every other week."""
    weeks = {week: [{"opponent": 2}] for week in range(11, 20)}
    for week in doubles:
        weeks[week] = [{"opponent": 2}, {"opponent": 3}]
    players = {1: {"id": 1, "team": 1}, 2: {"id": 2, "team": 1}}
    return SimpleNamespace(squad_ids=[1, 2], players_by_id=players, schedule={1: weeks})


def keep_with_doubles(context, weight, monkeypatch, notice=None):
    """Keep values after the window, with DOUBLE_WEIGHT and DOUBLE_NOTICE_WEEKS set for this test."""
    monkeypatch.setattr(strategy, "DOUBLE_WEIGHT", weight)
    monkeypatch.setattr(strategy, "DOUBLE_NOTICE_WEEKS", notice)
    values = chip_values()
    doubles = strategy.first_double_weeks(values, context, first_week=11, later=[16, 17, 18, 19])
    return strategy.keep_values(values, WINDOW_END, doubles)


def test_known_double_raises_bench_boost_and_triple_captain_by_the_weight(monkeypatch):
    plain = keep_with_doubles(squad_context(), 1.0, monkeypatch)
    weighted = keep_with_doubles(squad_context(doubles=(17, 19)), 1.5, monkeypatch)
    for chip in ("bboost", "3xc"):
        assert weighted[chip] == pytest.approx(plain[chip] * 1.5)


def test_no_double_leaves_keep_values_as_today(monkeypatch):
    values = chip_values()
    today = strategy.keep_values(values, WINDOW_END)
    assert keep_with_doubles(squad_context(), 1.5, monkeypatch) == today


def test_wildcard_and_free_hit_ignore_doubles(monkeypatch):
    plain = keep_with_doubles(squad_context(), 1.0, monkeypatch)
    weighted = keep_with_doubles(squad_context(doubles=(17, 19)), 1.5, monkeypatch)
    for chip in ("wildcard", "freehit"):
        assert weighted[chip] == plain[chip]


def test_double_too_far_ahead_is_not_known_yet(monkeypatch):
    plain = keep_with_doubles(squad_context(), 1.0, monkeypatch)
    unseen = keep_with_doubles(squad_context(doubles=(17, 19)), 1.5, monkeypatch, notice=5)
    assert unseen == plain
