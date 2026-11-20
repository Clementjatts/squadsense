"""Picks the best 15-player squad for one gameweek from scratch.

We use this when a team's real squad isn't public yet. FPL hides picks
until the gameweek deadline passes, so a team created this week has
nothing to read until then.

Choosing 15 players under a budget, a club limit and position rules is
an integer programming problem: every player gets a yes/no variable,
and a solver finds the yes/no mix with the highest score that breaks no
rule. Trying players one at a time (best first) tends to run out of
money halfway, which is why we hand it to a solver instead.
"""

import pulp

from . import rules

# How much a bench player's xP counts compared with a starter's. Above
# zero so the bench isn't four players who never play.
BENCH_WEIGHT = 0.1  # starting assumption


class SquadBuilderError(Exception):
    """Raised when the solver can't find a legal squad."""


def pick_best_squad(players, expected_points, gameweek, budget=rules.STARTING_BUDGET):
    """Returns the ids of the 15 players with the best xP for `gameweek`.

    `players` is the bootstrap-static `elements` list. The score is the
    starting eleven's xP with the captain counted twice, plus a small
    share of the bench's xP. Formation is left free within FPL's rules,
    so the solver picks whichever one scores most.
    """
    def xp(player):
        return expected_points.get(player["id"], {}).get(gameweek, 0.0)

    problem = pulp.LpProblem("best_squad", pulp.LpMaximize)
    # Three yes/no choices per player: in the squad, starting, captain.
    in_squad = {player["id"]: pulp.LpVariable(f"squad_{player['id']}", cat="Binary") for player in players}
    starts = {player["id"]: pulp.LpVariable(f"start_{player['id']}", cat="Binary") for player in players}
    captain = {player["id"]: pulp.LpVariable(f"captain_{player['id']}", cat="Binary") for player in players}

    problem += pulp.lpSum(
        xp(player) * (starts[player["id"]] + captain[player["id"]])
        + BENCH_WEIGHT * xp(player) * (in_squad[player["id"]] - starts[player["id"]])
        for player in players
    )
    _add_squad_rules(problem, players, in_squad, starts, captain, budget)

    # HiGHS runs natively on Apple Silicon and Linux. PuLP's bundled CBC
    # solver is Intel-only on Macs, so we don't use it.
    problem.solve(pulp.HiGHS(msg=False))
    if pulp.LpStatus[problem.status] != "Optimal":
        raise SquadBuilderError(f"No legal squad found (solver status: {pulp.LpStatus[problem.status]})")
    return [player["id"] for player in players if in_squad[player["id"]].value() > 0.5]


def _add_squad_rules(problem, players, in_squad, starts, captain, budget):
    """Adds FPL's squad, formation, club and budget rules to the problem."""
    problem += pulp.lpSum(player["now_cost"] * in_squad[player["id"]] for player in players) <= budget
    problem += pulp.lpSum(starts.values()) == 11
    problem += pulp.lpSum(captain.values()) == 1

    for player in players:
        # You can only start someone in your squad, and only captain a starter.
        problem += starts[player["id"]] <= in_squad[player["id"]]
        problem += captain[player["id"]] <= starts[player["id"]]

    for position, squad_count in rules.SQUAD_SHAPE.items():
        in_position = [player["id"] for player in players if player["element_type"] == position]
        problem += pulp.lpSum(in_squad[player_id] for player_id in in_position) == squad_count
        starters = pulp.lpSum(starts[player_id] for player_id in in_position)
        problem += starters >= rules.MIN_STARTERS[position]
        problem += starters <= rules.MAX_STARTERS[position]

    for club in {player["team"] for player in players}:
        from_club = [player["id"] for player in players if player["team"] == club]
        problem += pulp.lpSum(in_squad[player_id] for player_id in from_club) <= rules.MAX_PER_CLUB
