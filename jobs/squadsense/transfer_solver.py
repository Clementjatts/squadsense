"""Plans transfers across the whole planning window at once.

The single-transfer suggestions in planner.py test one move at a time.
This module asks a bigger question: over the next five gameweeks, which
mix of transfers, rolled transfers and hits gives the most expected
points? Rolling this week to make two moves next week, or taking a -4
because a double gameweek is coming, only shows up when every week is
planned together.

It's the same kind of yes/no integer problem as squad_builder.py, with
one copy of the squad per week, linked by the transfers in between.
"""

import pulp

from . import rules
from .planner import WEEKLY_DISCOUNT, squad_points_over_window
from .squad_builder import BENCH_WEIGHT

CANDIDATES_PER_POSITION = 12  # the best outsiders per position, by xP over the window
MAX_TRANSFERS_PER_WEEK = 3
# Points a banked free transfer is still worth at the end of the window, so
# the plan doesn't spend them all for tiny gains. Starting assumption.
END_FREE_TRANSFER_VALUE = 1.0
SOLVER_SECONDS = 30
BIG_NUMBER = 20  # larger than any possible count of free transfers or moves


class TransferSolverError(Exception):
    """Raised when the solver can't find any plan, even one with no transfers."""


def candidate_pool(squad_ids, players_by_id, expected_points, weeks):
    """The squad plus the best outsiders in each position."""
    def window_xp(player_id):
        return sum(expected_points.get(player_id, {}).get(week, 0.0) for week in weeks)

    pool = set(squad_ids)
    for position in rules.SQUAD_SHAPE:
        outsiders = [p["id"] for p in players_by_id.values() if p["element_type"] == position and p["id"] not in pool]
        outsiders.sort(key=window_xp, reverse=True)
        pool.update(outsiders[:CANDIDATES_PER_POSITION])
    return sorted(pool)


class PlanProblem:
    """The integer problem: variables for every player in every week, plus rules."""

    def __init__(self, squad_state, players_by_id, expected_points, weeks, pool):
        self.state = squad_state
        self.players = {player_id: players_by_id[player_id] for player_id in pool}
        self.xp = expected_points
        self.weeks = weeks
        self.unlimited_first_week = squad_state.free_transfers is None
        self.problem = pulp.LpProblem("transfer_plan", pulp.LpMaximize)
        self._make_variables()

    def _binary(self, name):
        return {(p, w): pulp.LpVariable(f"{name}_{p}_{w}", cat="Binary") for p in self.players for w in self.weeks}

    def _make_variables(self):
        """Yes/no per player per week, plus counts for transfers, hits and money."""
        self.squad, self.starts, self.captain = self._binary("squad"), self._binary("start"), self._binary("captain")
        self.buy, self.sell = self._binary("buy"), self._binary("sell")
        weeks = self.weeks
        self.free = {w: pulp.LpVariable(f"free_{w}", 0, rules.MAX_BANKED_FREE_TRANSFERS, cat="Integer") for w in weeks}
        self.hits = {w: pulp.LpVariable(f"hits_{w}", 0, cat="Integer") for w in weeks}
        self.carry = {w: pulp.LpVariable(f"carry_{w}", 0, cat="Integer") for w in weeks}
        self.carries_any = {w: pulp.LpVariable(f"carries_{w}", cat="Binary") for w in weeks}
        self.bank = {w: pulp.LpVariable(f"bank_{w}", 0) for w in weeks}

    def sale_price(self, player_id):
        """What selling him raises: his selling price if owned now, his current price if bought in the plan."""
        return self.state.selling_prices.get(player_id, self.players[player_id]["now_cost"])

    def transfers(self, week):
        return pulp.lpSum(self.buy[p, week] for p in self.players)

    def add_objective(self):
        """Lineup xP each week (captain twice, a little for the bench), minus hits."""
        total = []
        for offset, week in enumerate(self.weeks):
            discount = WEEKLY_DISCOUNT ** offset
            for p in self.players:
                points = self.xp.get(p, {}).get(week, 0.0)
                total.append(discount * points * (
                    self.starts[p, week] + self.captain[p, week]
                    + BENCH_WEIGHT * (self.squad[p, week] - self.starts[p, week])
                ))
            total.append(-rules.POINTS_PER_EXTRA_TRANSFER * self.hits[week])
        last = self.weeks[-1]
        total.append(END_FREE_TRANSFER_VALUE * self.carry[last])
        self.problem += pulp.lpSum(total)

    def add_squad_flow(self):
        """Each week's squad is last week's, minus sales, plus buys, and the money follows."""
        previous_bank = self.state.bank
        for index, week in enumerate(self.weeks):
            for p in self.players:
                before = (1 if p in self.state.player_ids else 0) if index == 0 else self.squad[p, self.weeks[index - 1]]
                self.problem += self.squad[p, week] == before + self.buy[p, week] - self.sell[p, week]
                self.problem += self.buy[p, week] + self.sell[p, week] <= 1
            money_in = pulp.lpSum(self.sale_price(p) * self.sell[p, week] for p in self.players)
            money_out = pulp.lpSum(self.players[p]["now_cost"] * self.buy[p, week] for p in self.players)
            self.problem += self.bank[week] == previous_bank + money_in - money_out
            previous_bank = self.bank[week]

    def add_free_transfer_rules(self):
        """Free transfers bank up to five; moves beyond them cost a hit each.

        `carry` is what's left after this week's moves, never below zero.
        The yes/no `carries_any` stops the solver pretending to carry
        transfers it used up by paying for extra hits.
        """
        for index, week in enumerate(self.weeks):
            moves = self.transfers(week)
            if index == 0 and self.unlimited_first_week:
                # A team's first gameweek: any number of free moves, and none carry over.
                self.problem += self.hits[week] == 0
                self.problem += self.carry[week] == 0
            else:
                self.problem += moves <= MAX_TRANSFERS_PER_WEEK
                self.problem += self.hits[week] >= moves - self.free[week]
                self.problem += self.carry[week] <= self.free[week] - moves + BIG_NUMBER * (1 - self.carries_any[week])
                self.problem += self.carry[week] <= BIG_NUMBER * self.carries_any[week]
            if index == 0 and not self.unlimited_first_week:
                self.problem += self.free[week] == min(self.state.free_transfers, rules.MAX_BANKED_FREE_TRANSFERS)
            if index + 1 < len(self.weeks):
                self.problem += self.free[self.weeks[index + 1]] <= self.carry[week] + 1

    def add_lineup_rules(self):
        """Every week: 15 in shape, 3 per club at most, a legal eleven and one captain."""
        for week in self.weeks:
            self.problem += pulp.lpSum(self.starts[p, week] for p in self.players) == 11
            self.problem += pulp.lpSum(self.captain[p, week] for p in self.players) == 1
            for p in self.players:
                self.problem += self.starts[p, week] <= self.squad[p, week]
                self.problem += self.captain[p, week] <= self.starts[p, week]
            for position, count in rules.SQUAD_SHAPE.items():
                in_position = [p for p, player in self.players.items() if player["element_type"] == position]
                self.problem += pulp.lpSum(self.squad[p, week] for p in in_position) == count
                starters = pulp.lpSum(self.starts[p, week] for p in in_position)
                self.problem += starters >= rules.MIN_STARTERS[position]
                self.problem += starters <= rules.MAX_STARTERS[position]
            for club in {player["team"] for player in self.players.values()}:
                from_club = [p for p, player in self.players.items() if player["team"] == club]
                self.problem += pulp.lpSum(self.squad[p, week] for p in from_club) <= rules.MAX_PER_CLUB

    def solve(self):
        """Builds and solves the problem. Raises TransferSolverError if no plan is found."""
        self.add_objective()
        self.add_squad_flow()
        self.add_free_transfer_rules()
        self.add_lineup_rules()
        self.problem.solve(pulp.HiGHS(msg=False, timeLimit=SOLVER_SECONDS))
        if self.problem.sol_status not in (pulp.LpSolutionOptimal, pulp.LpSolutionIntegerFeasible):
            raise TransferSolverError(f"No transfer plan found (solver status: {pulp.LpStatus[self.problem.status]})")


def pair_moves(sold, bought, players_by_id):
    """Matches each sale with a purchase in the same position, for display."""
    pairs = []
    remaining = list(bought)
    for out_id in sold:
        position = players_by_id[out_id]["element_type"]
        in_id = next(p for p in remaining if players_by_id[p]["element_type"] == position)
        remaining.remove(in_id)
        pairs.append({"out": out_id, "in": in_id})
    return pairs


def read_plan(plan, players_by_id):
    """Turns the solved problem into one entry per week for the website."""
    weeks = []
    for week in plan.weeks:
        chosen = lambda variables: [p for p in plan.players if variables[p, week].value() > 0.5]
        captain = chosen(plan.captain)[0]
        starters = chosen(plan.starts)
        xp = sum(plan.xp.get(p, {}).get(week, 0.0) for p in starters) + plan.xp.get(captain, {}).get(week, 0.0)
        weeks.append({
            "gameweek": week,
            "moves": pair_moves(chosen(plan.sell), chosen(plan.buy), players_by_id),
            "hits": round(plan.hits[week].value()),
            "freeTransfers": None if week == plan.weeks[0] and plan.unlimited_first_week else round(plan.free[week].value()),
            "bank": round(plan.bank[week].value()),
            "captain": captain,
            "xp": round(xp, 2),
        })
    return weeks


def solve_transfer_plan(squad_state, players_by_id, expected_points, weeks):
    """The best transfer plan over `weeks`, or None for a squad the model picked.

    `gain` compares the plan's discounted xP (after hits) with keeping the
    squad as it is, using the same discounting as the single-move suggestions.
    """
    if squad_state.squad_source == "model":
        return None
    pool = candidate_pool(squad_state.player_ids, players_by_id, expected_points, weeks)
    plan = PlanProblem(squad_state, players_by_id, expected_points, weeks, pool)
    plan.solve()
    plan_weeks = read_plan(plan, players_by_id)

    plan_value = sum(
        WEEKLY_DISCOUNT ** offset * (week["xp"] - rules.POINTS_PER_EXTRA_TRANSFER * week["hits"])
        for offset, week in enumerate(plan_weeks)
    )
    keep_value = squad_points_over_window(squad_state.player_ids, players_by_id, expected_points, weeks)
    return {
        "weeks": plan_weeks,
        "totalHits": sum(week["hits"] for week in plan_weeks),
        "gain": round(plan_value - keep_value, 2),
    }
