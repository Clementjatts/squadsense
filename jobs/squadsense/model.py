"""Expected points (xP) for each player in each upcoming gameweek.

The idea: work out how often a player shoots, creates and defends per 90
minutes, guess how many minutes he'll play, then scale by how kind the
fixture is. The weights are simple and explainable, and each one notes
what the backtest (squadsense/backtest.py) found about it.
"""

import math
from dataclasses import dataclass

from . import rules
from .fixtures import LEAGUE_AVERAGE_GOALS

# Weights below were checked with the backtest (python -m squadsense.backtest)
# on 2022-23 to 2024-25 and on 2026-27 GW4-10. See docs/backtest-results.md.
# "No clear difference" means other values moved the results by less than
# the noise, so the original guess stays.

# A match this many appearances ago counts half as much as the latest one.
HALF_LIFE_MATCHES = 6  # backtest: 3 to 20 made no clear difference
# How many minutes of "typical player for his position" we blend in.
# With 450 here, a player on 900 minutes is two-thirds his own numbers.
PRIOR_MINUTES = 450  # backtest: 90 to 720 made no clear difference
# Share of the final number that comes from recent actual FPL points.
RECENT_POINTS_WEIGHT = 0.15  # backtest: 0 to 0.3 made no clear difference
RECENT_MATCHES = 5
# Most minutes of last season's numbers that count towards a player's
# starting point. 0 turns the past-season prior off.
PAST_MINUTES_CAP = 900  # backtest 2026-27 GW4-10: captain 6.43 to 7.43, top20 4.84 to 5.02 (450 to 3400 all similar)
# Fewer minutes than this last season and his past numbers are ignored.
PAST_MINUTES_MINIMUM = 270

# Typical per-90 rates by position, used to steady small samples.
POSITION_PRIORS = {
    rules.GOALKEEPER: {"xg": 0.0, "xa": 0.01, "bonus": 0.25, "saves": 2.8},
    rules.DEFENDER: {"xg": 0.04, "xa": 0.05, "bonus": 0.25, "saves": 0.0},
    rules.MIDFIELDER: {"xg": 0.15, "xa": 0.13, "bonus": 0.3, "saves": 0.0},
    # Forwards averaged 0.50-0.72 bonus per start in every season checked,
    # so the old 0.4 guess was too low.
    rules.FORWARD: {"xg": 0.35, "xa": 0.10, "bonus": 0.6, "saves": 0.0},
}

# FPL awards more assists than xA predicts (deflections, rebounds, penalties
# won). Measured: 1.41 FPL assists per xA in 2023-24, 1.38 in 2024-25 and
# 1.39 in 2026-27 so far. (2022-23 was 2.12, the xA provider's first FPL
# season, so it's left out of the estimate.)
ASSIST_FACTOR = 1.4

MINUTES_WHEN_STARTING = 85
MINUTES_WHEN_SUBBED_ON = 25


@dataclass
class PlayerRates:
    """What a player tends to do per 90 minutes, plus how often he plays."""

    xg_per_90: float
    xa_per_90: float
    bonus_per_90: float
    saves_per_90: float
    defensive_contribution_rate: float
    chance_60_minutes: float
    chance_under_60: float
    recent_points_per_match: float


def _as_float(value):
    """FPL sends xG and xA as strings like "0.42"; this turns them into numbers."""
    return float(value) if value not in (None, "") else 0.0


def _recency_weight(matches_ago):
    return 0.5 ** (matches_ago / HALF_LIFE_MATCHES)


def _blend_with_prior(weighted_total, weighted_minutes, prior_per_90):
    """Per-90 rate that leans on the position prior when minutes are low."""
    prior_total = prior_per_90 * PRIOR_MINUTES / 90
    return 90 * (weighted_total + prior_total) / (weighted_minutes + PRIOR_MINUTES)


def past_season_rates(past_seasons):
    """Last season's per-90 xG, xA, bonus and saves, plus the minutes behind them.

    `past_seasons` is element-summary `history_past`, oldest first. Returns
    None when he played too little last season for the numbers to mean much.
    """
    if not past_seasons:
        return None
    last = past_seasons[-1]
    minutes = last.get("minutes", 0)
    if minutes < PAST_MINUTES_MINIMUM:
        return None
    per_90 = {
        "xg": _as_float(last.get("expected_goals")) * 90 / minutes,
        "xa": _as_float(last.get("expected_assists")) * 90 / minutes,
        "bonus": last.get("bonus", 0) * 90 / minutes,
        "saves": last.get("saves", 0) * 90 / minutes,
    }
    return per_90, minutes


def starting_rates(position, past_seasons):
    """The per-90 rates a player starts from before this season's matches count.

    That's the typical rate for his position, moved towards his own rate
    last season. Up to PAST_MINUTES_CAP minutes of last season count, set
    against PRIOR_MINUTES of the position average.
    """
    prior = POSITION_PRIORS[position]
    past = past_season_rates(past_seasons)
    if past is None or PAST_MINUTES_CAP == 0:
        return prior
    per_90, minutes = past
    past_weight = min(minutes, PAST_MINUTES_CAP)
    return {
        stat: (prior[stat] * PRIOR_MINUTES + per_90[stat] * past_weight) / (PRIOR_MINUTES + past_weight)
        for stat in prior
    }


def playing_chances(player, history_rows):
    """Chance of playing 60+ minutes and chance of a shorter appearance.

    Starts from his share of the last five matches, then scales by FPL's
    own availability flag (75%, 50% and so on). No history means a new
    signing, so we assume he's a squad player until he proves otherwise.
    """
    availability = player.get("chance_of_playing_next_round")
    availability = 1.0 if availability is None else availability / 100

    recent = history_rows[-RECENT_MATCHES:]
    if not recent:
        return 0.5 * availability, 0.2 * availability

    full_games = sum(1 for row in recent if row["minutes"] >= 60)
    short_games = sum(1 for row in recent if 0 < row["minutes"] < 60)
    return availability * full_games / len(recent), availability * short_games / len(recent)


def defensive_contribution_rate(position, history_rows):
    """Share of recent full games where he hit the defensive contribution target."""
    threshold = rules.DEFENSIVE_CONTRIBUTION_THRESHOLD[position]
    full_games = [row for row in history_rows[-10:] if row["minutes"] >= 60]
    if threshold is None or not full_games:
        return 0.0
    hits = sum(1 for row in full_games if row.get("defensive_contribution", 0) >= threshold)
    return hits / len(full_games)


def player_rates(player, history_rows, past_seasons=None):
    """Builds PlayerRates from bootstrap data plus element-summary history.

    `history_rows` must be oldest first, one row per club match, which is
    how FPL returns them. `past_seasons` is his `history_past`; without it
    he starts from his position's typical numbers.
    """
    position = player["element_type"]
    prior = starting_rates(position, past_seasons)
    appearances = [row for row in history_rows if row["minutes"] > 0]

    totals = {"xg": 0.0, "xa": 0.0, "bonus": 0.0, "saves": 0.0}
    weighted_minutes = 0.0
    for matches_ago, row in enumerate(reversed(appearances)):
        weight = _recency_weight(matches_ago)
        weighted_minutes += weight * row["minutes"]
        totals["xg"] += weight * _as_float(row.get("expected_goals"))
        totals["xa"] += weight * _as_float(row.get("expected_assists"))
        totals["bonus"] += weight * row.get("bonus", 0)
        totals["saves"] += weight * row.get("saves", 0)

    recent_appearances = appearances[-RECENT_MATCHES:]
    recent_points = (
        sum(row["total_points"] for row in recent_appearances) / len(recent_appearances)
        if recent_appearances
        else 0.0
    )
    chance_60, chance_short = playing_chances(player, history_rows)

    return PlayerRates(
        xg_per_90=_blend_with_prior(totals["xg"], weighted_minutes, prior["xg"]),
        xa_per_90=_blend_with_prior(totals["xa"], weighted_minutes, prior["xa"]),
        bonus_per_90=_blend_with_prior(totals["bonus"], weighted_minutes, prior["bonus"]),
        saves_per_90=_blend_with_prior(totals["saves"], weighted_minutes, prior["saves"]),
        defensive_contribution_rate=defensive_contribution_rate(position, history_rows),
        chance_60_minutes=chance_60,
        chance_under_60=chance_short,
        recent_points_per_match=recent_points,
    )


def expected_points_for_match(position, team_id, rates, match, fixture_model):
    """xP for one match. Follows the formula in the planning doc, section 3."""
    expected_minutes_share = (
        rates.chance_60_minutes * MINUTES_WHEN_STARTING + rates.chance_under_60 * MINUTES_WHEN_SUBBED_ON
    ) / 90
    team_goals = fixture_model.expected_goals(team_id, match["opponent"], match["is_home"])
    goals_against = fixture_model.expected_goals(match["opponent"], team_id, not match["is_home"])
    attack_multiplier = team_goals / LEAGUE_AVERAGE_GOALS

    appearance_points = (
        rates.chance_60_minutes * rules.POINTS_FOR_60_MINUTES
        + rates.chance_under_60 * rules.POINTS_FOR_UNDER_60_MINUTES
    )
    attacking_points = expected_minutes_share * attack_multiplier * (
        rates.xg_per_90 * rules.POINTS_FOR_GOAL[position] + rates.xa_per_90 * ASSIST_FACTOR * rules.POINTS_FOR_ASSIST
    )
    # Clean sheets and goals-conceded penalties only count after 60 minutes.
    clean_sheet_points = rates.chance_60_minutes * math.exp(-goals_against) * rules.POINTS_FOR_CLEAN_SHEET[position]
    conceded_penalty = 0.0
    if position in (rules.GOALKEEPER, rules.DEFENDER):
        conceded_penalty = rates.chance_60_minutes * goals_against / 2
    save_points = expected_minutes_share * rates.saves_per_90 / 3
    defensive_points = (
        rates.chance_60_minutes * rates.defensive_contribution_rate * rules.POINTS_FOR_DEFENSIVE_CONTRIBUTION
    )
    bonus_points = expected_minutes_share * rates.bonus_per_90

    return (
        appearance_points
        + attacking_points
        + clean_sheet_points
        - conceded_penalty
        + save_points
        + defensive_points
        + bonus_points
    )


def expected_points_for_week(player, rates, matches, fixture_model):
    """xP for a whole gameweek: zero for a blank, both games for a double."""
    model_points = sum(
        expected_points_for_match(player["element_type"], player["team"], rates, match, fixture_model)
        for match in matches
    )
    # Recent real points nudge the estimate to catch role changes the
    # underlying stats miss, such as a new penalty taker.
    availability = rates.chance_60_minutes + rates.chance_under_60
    recent_points = rates.recent_points_per_match * availability * len(matches)
    blended = (1 - RECENT_POINTS_WEIGHT) * model_points + RECENT_POINTS_WEIGHT * recent_points
    return round(blended, 2)
