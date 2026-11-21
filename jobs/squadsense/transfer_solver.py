"""Plans transfers across the whole planning window at once.

The single-transfer suggestions in planner.py test one move at a time.
This module asks a bigger question: over the next five gameweeks, which
mix of transfers, rolled transfers and hits gives the most expected
points? Rolling this week to make two moves next week, or taking a -4
because a double gameweek is coming, only shows up when every week is
planned together.

It's the same kind of yes/no integer problem as squad_builder.py, with
one copy of the squad per week, linked by the transfers in between.

All four chips can be planned in too, so the plan can, say, bring in two
bench players who play twice before a Bench Boost week. Free Hit is
handled by working out the best one-week squad for each week in advance
(`free_hit_best`): in a Free Hit week that squad scores instead of yours,
and your own squad can't make transfers, exactly as in FPL.

Prices: the first week's moves are assumed to be made now, before the
next price change at 00:00 UK. For later weeks, players FPL expects to
rise or fall tonight (`price_moves`) cost or sell for £0.1m more or less,
so the plan can see the point of buying before a rise or selling before
a fall.

Each chip also has a "keep" value: what it's worth if saved for later in
the half (see strategy.py). Not playing a chip earns that value, so the
plan only spends a chip inside these five weeks when that beats saving it.
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
SOLVER_SECONDS = 300
# Stop once the plan is proven to be within 0.2% of the best possible one,
# about half a point over five weeks. At 1% (about 3 points) chip choices
# worth a few points fell inside the slack and flipped between runs on
# the same data (21 November 2026). At 0.2% the real squad's plan with
# every chip took about 45 seconds.
SOLVER_GAP = 0.002
BIG_NUMBER = 20  # larger than any possible count of free transfers or moves
NEGATIVE_GAIN_TOLERANCE = 0.5  # xP; an unfinished plan worse than doing nothing by more than this is rejected
SOLVER_CHIPS = ("bboost", "3xc", "freehit", "wildcard")


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

    def __init__(self, squad_state, players_by_id, expected_points, weeks, pool, chip_weeks=None, free_hit_best=None, keep_values=None, price_moves=None):
        self.state = squad_state
        self.price_moves = price_moves or {}  # {player_id: +1 or -1}, tonight's likely change
        self.chip_weeks = chip_weeks or {}  # {chip: [weeks it may be played]}
        self.free_hit_best = free_hit_best or {}  # {week: {"points": xP, "squad": [ids]}}
        self.keep_values = keep_values or {}  # {chip: points it's worth saved for later}
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
        # One yes/no per chip and week it's allowed in, plus how much of each
        # player's xP the chip adds (bench players for Bench Boost, the
        # captain once more for Triple Captain).
        self.chip = {
            (chip, w): pulp.LpVariable(f"chip_{chip}_{w}", cat="Binary") for chip, allowed in self.chip_weeks.items() for w in allowed
        }
        self.bench_boosted = {key: pulp.LpVariable(f"bb_{key[0]}_{key[1]}", 0, 1) for key in self.squad}
        self.triple = {key: pulp.LpVariable(f"tc_{key[0]}_{key[1]}", 0, 1) for key in self.squad}
        # The bench's small share of the score, switched off in a Free Hit week
        # (your own squad sits that week out).
        self.benched = {key: pulp.LpVariable(f"bench_{key[0]}_{key[1]}", 0, 1) for key in self.squad}

    def chip_played(self, chip, week):
        """The yes/no for `chip` in `week`, or 0 when it can't be played then."""
        return self.chip.get((chip, week), 0)

    def buy_price(self, player_id, week_index):
        """His price in the plan's `week_index`-th week: today's for the first week, after tonight's likely change later."""
        change = self.price_moves.get(player_id, 0) if week_index > 0 else 0
        return self.players[player_id]["now_cost"] + change

    def sale_price(self, player_id, week_index):
        """What selling him raises in that week.

        Owned now: today's selling price in the first week; later, the
        selling price worked out again after tonight's likely change.
        Bought during the plan: roughly what he cost.
        """
        if player_id not in self.state.selling_prices:
            return self.buy_price(player_id, week_index)
        purchase = self.state.purchase_prices.get(player_id)
        if week_index == 0 or purchase is None or player_id not in self.price_moves:
            return self.state.selling_prices[player_id]
        return rules.selling_price(purchase, self.buy_price(player_id, week_index))

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
                    + BENCH_WEIGHT * self.benched[p, week]
                    + (1 - BENCH_WEIGHT) * self.bench_boosted[p, week]
                    + self.triple[p, week]
                ))
            free_hit = self.free_hit_best.get(week)
            if free_hit:
                total.append(discount * free_hit["points"] * self.chip_played("freehit", week))
            total.append(-rules.POINTS_PER_EXTRA_TRANSFER * self.hits[week])
        last = self.weeks[-1]
        total.append(END_FREE_TRANSFER_VALUE * self.carry[last])
        for chip, allowed in self.chip_weeks.items():
            # A chip left unplayed is still worth its keep value later in the half.
            total.append(self.keep_values.get(chip, 0.0) * (1 - pulp.lpSum(self.chip[chip, w] for w in allowed)))
        self.problem += pulp.lpSum(total)

    def add_squad_flow(self):
        """Each week's squad is last week's, minus sales, plus buys, and the money follows."""
        previous_bank = self.state.bank
        for index, week in enumerate(self.weeks):
            for p in self.players:
                before = (1 if p in self.state.player_ids else 0) if index == 0 else self.squad[p, self.weeks[index - 1]]
                self.problem += self.squad[p, week] == before + self.buy[p, week] - self.sell[p, week]
                self.problem += self.buy[p, week] + self.sell[p, week] <= 1
            money_in = pulp.lpSum(self.sale_price(p, index) * self.sell[p, week] for p in self.players)
            money_out = pulp.lpSum(self.buy_price(p, index) * self.buy[p, week] for p in self.players)
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
            wildcard = self.chip_played("wildcard", week)
            free_hit = self.chip_played("freehit", week)
            # In a Free Hit week your own squad stays as it is.
            self.problem += moves <= 15 * (1 - free_hit)
            if index == 0 and self.unlimited_first_week:
                # A team's first gameweek: any number of free moves, and none carry over.
                self.problem += self.hits[week] == 0
                self.problem += self.carry[week] == 0
            else:
                # A Wildcard week has unlimited free moves and keeps the banked transfers.
                self.problem += moves <= MAX_TRANSFERS_PER_WEEK + 15 * wildcard
                self.problem += self.hits[week] >= moves - self.free[week] - BIG_NUMBER * wildcard
                self.problem += self.carry[week] <= self.free[week] - moves + BIG_NUMBER * (1 - self.carries_any[week]) + BIG_NUMBER * (wildcard + free_hit)
                self.problem += self.carry[week] <= BIG_NUMBER * self.carries_any[week]
                self.problem += self.carry[week] <= self.free[week]
            if index == 0 and not self.unlimited_first_week:
                self.problem += self.free[week] == min(self.state.free_transfers, rules.MAX_BANKED_FREE_TRANSFERS)
            if index + 1 < len(self.weeks):
                self.problem += self.free[self.weeks[index + 1]] <= self.carry[week] + 1

    def add_chip_rules(self):
        """Each chip at most once, one chip per week, and chip points only where the chip is played."""
        for chip, allowed in self.chip_weeks.items():
            self.problem += pulp.lpSum(self.chip[chip, w] for w in allowed) <= 1
        for week in self.weeks:
            self.problem += pulp.lpSum(self.chip_played(chip, week) for chip in self.chip_weeks) <= 1
            for p in self.players:
                self.problem += self.benched[p, week] <= self.squad[p, week] - self.starts[p, week]
                self.problem += self.benched[p, week] <= 1 - self.chip_played("freehit", week)
                self.problem += self.bench_boosted[p, week] <= self.squad[p, week] - self.starts[p, week]
                self.problem += self.bench_boosted[p, week] <= self.chip_played("bboost", week)
                self.problem += self.triple[p, week] <= self.captain[p, week]
                self.problem += self.triple[p, week] <= self.chip_played("3xc", week)

    def add_lineup_rules(self):
        """Every week: 15 in shape, 3 per club at most, a legal eleven and one captain.

        In a Free Hit week your own squad fields nobody, since the
        one-week squad plays instead.
        """
        for week in self.weeks:
            playing = 1 - self.chip_played("freehit", week)
            self.problem += pulp.lpSum(self.starts[p, week] for p in self.players) == 11 * playing
            self.problem += pulp.lpSum(self.captain[p, week] for p in self.players) == playing
            for p in self.players:
                self.problem += self.starts[p, week] <= self.squad[p, week]
                self.problem += self.captain[p, week] <= self.starts[p, week]
            for position, count in rules.SQUAD_SHAPE.items():
                in_position = [p for p, player in self.players.items() if player["element_type"] == position]
                self.problem += pulp.lpSum(self.squad[p, week] for p in in_position) == count
                starters = pulp.lpSum(self.starts[p, week] for p in in_position)
                self.problem += starters >= rules.MIN_STARTERS[position] * playing
                self.problem += starters <= rules.MAX_STARTERS[position]
            for club in {player["team"] for player in self.players.values()}:
                from_club = [p for p, player in self.players.items() if player["team"] == club]
                self.problem += pulp.lpSum(self.squad[p, week] for p in from_club) <= rules.MAX_PER_CLUB

    def solve(self, seconds=None):
        """Builds and solves the problem within `seconds` (SOLVER_SECONDS if not given).

        Raises TransferSolverError if no plan is found.
        """
        self.add_objective()
        self.add_squad_flow()
        self.add_free_transfer_rules()
        self.add_chip_rules()
        self.add_lineup_rules()
        self.problem.solve(pulp.HiGHS(msg=False, timeLimit=seconds or SOLVER_SECONDS, gapRel=SOLVER_GAP))
        if self.problem.sol_status not in (pulp.LpSolutionOptimal, pulp.LpSolutionIntegerFeasible):
            raise TransferSolverError(f"No transfer plan found (solver status: {pulp.LpStatus[self.problem.status]})")

    def finished_search(self):
        """True if the solver proved its plan is within SOLVER_GAP of the best, False if time ran out first."""
        return self.problem.sol_status == pulp.LpSolutionOptimal


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
        chip = next((name for name in plan.chip_weeks if pulp.value(plan.chip_played(name, week)) > 0.5), None)
        squad = chosen(plan.squad)
        if chip == "freehit":
            free_hit = plan.free_hit_best[week]
            captain, xp = free_hit["captain"], free_hit["points"]
        else:
            captain = chosen(plan.captain)[0]
            counted = squad if chip == "bboost" else chosen(plan.starts)
            captain_times = 2 if chip == "3xc" else 1
            xp = sum(plan.xp.get(p, {}).get(week, 0.0) for p in counted) + captain_times * plan.xp.get(captain, {}).get(week, 0.0)
        weeks.append({
            "gameweek": week,
            "squad": squad,  # your own squad after this week's moves
            "freeHitSquad": plan.free_hit_best[week]["squad"] if chip == "freehit" else None,
            "moves": pair_moves(chosen(plan.sell), chosen(plan.buy), players_by_id),
            "hits": round(plan.hits[week].value()),
            "freeTransfers": None if week == plan.weeks[0] and plan.unlimited_first_week else round(plan.free[week].value()),
            "bank": round(plan.bank[week].value()),
            "captain": captain,
            "chip": chip,
            "xp": round(xp, 2),
        })
    return weeks


def solve_transfer_plan(squad_state, players_by_id, expected_points, weeks, chip_weeks=None, free_hit_best=None, keep_values=None, price_moves=None, seconds=None):
    """The best transfer plan over `weeks`, or None for a squad the model picked.

    `chip_weeks` is {chip: [weeks it may be played]} for the chips still
    available; leave it out to plan transfers only. `free_hit_best` is
    needed when Free Hit is allowed, and `keep_values` gives each chip's
    worth if saved (see strategy.py). `price_moves` is tonight's likely
    price changes (price_watch.likely_price_moves); `seconds` overrides
    the time limit.

    `gain` compares the plan's discounted xP (after hits) with keeping the
    squad as it is, using the same discounting as the single-move suggestions.
    """
    if squad_state.squad_source == "model":
        return None
    pool = candidate_pool(squad_state.player_ids, players_by_id, expected_points, weeks)
    plan = PlanProblem(squad_state, players_by_id, expected_points, weeks, pool, chip_weeks, free_hit_best, keep_values, price_moves)
    plan.solve(seconds)
    plan_weeks = read_plan(plan, players_by_id)

    plan_value = sum(
        WEEKLY_DISCOUNT ** offset * (week["xp"] - rules.POINTS_PER_EXTRA_TRANSFER * week["hits"])
        for offset, week in enumerate(plan_weeks)
    )
    keep_value = squad_points_over_window(squad_state.player_ids, players_by_id, expected_points, weeks)
    gain = plan_value - keep_value
    # When time runs out early, the solver can hand back a poor plan that
    # merely follows the rules. Never show one clearly worse than doing
    # nothing. A finished search is trusted: its tiny negative gains come
    # from rounding, or from the bench and banked-transfer values the
    # plan also weighs.
    if not plan.finished_search() and gain < -NEGATIVE_GAIN_TOLERANCE:
        raise TransferSolverError(f"Time ran out before finding a plan better than making no moves ({gain:.1f} xP)")
    return {
        "weeks": plan_weeks,
        "totalHits": sum(week["hits"] for week in plan_weeks),
        "chips": {week["chip"]: week["gameweek"] for week in plan_weeks if week["chip"]},
        "gain": round(gain, 2),
        "finishedSearch": plan.finished_search(),
    }
