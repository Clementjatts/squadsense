"""How spread out a captain's points could be, not just his average.

Two players can both be worth 6 expected points: one scores 5 to 7 most
weeks, the other blanks often but sometimes gets 15. For captaincy the
second is often the better gamble. This module plays each captain
option's week many times with random goals, assists and clean sheets
drawn from the model's own rates, and counts how often he hauls.

The draws use a fixed seed per player, so the same data gives the same
numbers on every run.

The simulation on its own was too sure of hauls: on past seasons, options
it gave over 60% hauled about 30% of the time. So the chances it returns
are corrected with Platt scaling, using two numbers per measure fitted on
past results by captain_calibration.py (see docs/backtest-results.md).
"""

import math
import random

from . import rules
from .fixtures import LEAGUE_AVERAGE_GOALS
from .model import ASSIST_FACTOR, MINUTES_WHEN_STARTING, MINUTES_WHEN_SUBBED_ON

SIMULATIONS = 4000
HAUL_POINTS = 10  # his own points, before the captain doubles them
BLANK_POINTS = 2  # an appearance and nothing else
# Platt scaling numbers (a, b) from `python -m squadsense.captain_calibration`.
# Fitted 24 November 2026 on 560 past captain options. (0.0, 1.0) would leave a chance unchanged.
HAUL_CALIBRATION = (-0.808, 0.358)
BLANK_CALIBRATION = (-0.014, 0.576)
CLAMP = 0.005  # raw chances are kept between 0.5% and 99.5% so the logit stays finite


def calibrate(chance, numbers):
    """A simulated chance corrected with Platt scaling: 1 / (1 + e^-(a + b * logit(chance)))."""
    a, b = numbers
    clamped = min(max(chance, CLAMP), 1 - CLAMP)
    logit = math.log(clamped / (1 - clamped))
    return 1 / (1 + math.exp(-(a + b * logit)))


def poisson(rng, mean):
    """A random count with the given average (Knuth's method; fine for small means)."""
    limit = math.exp(-mean)
    count, product = 0, rng.random()
    while product > limit:
        count += 1
        product *= rng.random()
    return count


def bonus_for(goals, assists):
    """A rough bonus guess from his returns: goals earn more bonus than assists."""
    return min(3, round(goals * 1.5 + assists * 0.8))


def simulate_match(rng, position, team_id, rates, match, fixture_model):
    """One random outcome of one match, in FPL points."""
    roll = rng.random()
    if roll < rates.chance_60_minutes:
        minutes_share, full_game = MINUTES_WHEN_STARTING / 90, True
    elif roll < rates.chance_60_minutes + rates.chance_under_60:
        minutes_share, full_game = MINUTES_WHEN_SUBBED_ON / 90, False
    else:
        return 0

    team_goals = fixture_model.expected_goals(team_id, match["opponent"], match["is_home"])
    goals_against_mean = fixture_model.expected_goals(match["opponent"], team_id, not match["is_home"])
    attack = team_goals / LEAGUE_AVERAGE_GOALS
    goals = poisson(rng, rates.xg_per_90 * minutes_share * attack)
    assists = poisson(rng, rates.xa_per_90 * ASSIST_FACTOR * minutes_share * attack)

    points = rules.POINTS_FOR_60_MINUTES if full_game else rules.POINTS_FOR_UNDER_60_MINUTES
    points += goals * rules.POINTS_FOR_GOAL[position] + assists * rules.POINTS_FOR_ASSIST
    if full_game:
        conceded = poisson(rng, goals_against_mean)
        if conceded == 0:
            points += rules.POINTS_FOR_CLEAN_SHEET[position]
        if position in (rules.GOALKEEPER, rules.DEFENDER):
            points -= conceded // 2
        if rng.random() < rates.defensive_contribution_rate:
            points += rules.POINTS_FOR_DEFENSIVE_CONTRIBUTION
    points += poisson(rng, rates.saves_per_90 * minutes_share) // 3
    return points + bonus_for(goals, assists)


def simulated_chances(player, rates, matches, fixture_model, simulations=SIMULATIONS):
    """The simulation's own haul and blank chances for one gameweek, before any correction.

    A double gameweek adds both matches together. A blank week returns zeros.
    """
    if not matches:
        return {"haulChance": 0.0, "blankChance": 1.0}
    rng = random.Random(player["id"])
    hauls = blanks = 0
    for _ in range(simulations):
        points = sum(
            simulate_match(rng, player["element_type"], player["team"], rates, match, fixture_model)
            for match in matches
        )
        hauls += points >= HAUL_POINTS
        blanks += points <= BLANK_POINTS
    return {"haulChance": hauls / simulations, "blankChance": blanks / simulations}


def outcome_chances(player, rates, matches, fixture_model, simulations=SIMULATIONS):
    """Chance he hauls (HAUL_POINTS or more) and chance he blanks, corrected from history.

    A week with no match is certain: 0% haul and 100% blank.
    """
    if not matches:
        return {"haulChance": 0.0, "blankChance": 1.0}
    raw = simulated_chances(player, rates, matches, fixture_model, simulations)
    return {
        "haulChance": round(calibrate(raw["haulChance"], HAUL_CALIBRATION), 3),
        "blankChance": round(calibrate(raw["blankChance"], BLANK_CALIBRATION), 3),
    }
