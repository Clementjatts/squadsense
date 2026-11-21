"""One chip strategy for the whole app.

Every page that talks about chips (the Chip Planner, the Dashboard's
"This week" card and the Planner) shows the decision made here, so they
can never disagree. The rules:

1. Plan five weeks of transfers and chips together (transfer_solver.py),
   aiming for the most expected points after hits.
2. Measure everything against what normal free transfers would do anyway.
   A Wildcard or Free Hit is only worth the part of the gap to the best
   squad that your normal transfers wouldn't close.
3. Each chip has a keep value: PLAY_SHARE of its best value later in the
   half, after the five weeks. The plan only plays a chip now if that
   beats saving it. (PLAY_SHARE came from the chip backtest.)
4. A Wildcard rebuilds the team and can't be undone, so it also has to
   clear WILDCARD_MARGIN points before the plan uses it.
5. Anything within CLOSE_CALL points of saving the chip is shown as a
   close call, for you to decide.

When the transfer plan can't run (a squad the model picked, or no plan
found in time), chips fall back to the simple best-week estimate and the
pages say so.

Solving the plan with every chip takes a minute or two, so the result is
saved and reused until something that matters changes: the gameweek,
your squad, bank, free transfers, chips used, injury news on your
players, or the saved plan being MAX_PLAN_AGE_HOURS old.
"""

import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

import numpy

from . import chips
from .captaincy import outcome_chances
from .chips import ChipValue, chance_all_play
from .planner import WEEKLY_DISCOUNT, best_lineup
from .price_watch import likely_price_moves
from .squad_builder import pick_best_squad
from .transfer_solver import SOLVER_CHIPS, TransferSolverError, solve_transfer_plan

log = logging.getLogger("squadsense.strategy")

WILDCARD_MARGIN = 5.0  # points; a judgement call, about 70% confident, until the transfer plan is backtested
CLOSE_CALL = 2.0  # points between playing and saving a chip that count as "your call"
MAX_PLAN_AGE_HOURS = 12  # re-plan at least twice a day, so new matches and form count
# How sure is each move: the plan is re-solved this many times with random
# noise on every player's xP, and each move's share of runs is shown.
SENSITIVITY_RUNS = 15
SENSITIVITY_SECONDS = 30  # per run; these runs only check the transfers, chips stay as decided
# Bump this whenever the strategy's rules change, so a saved plan made under old rules isn't reused.
STRATEGY_VERSION = 6


def scaled(value, keep_share, note):
    """A chip value reduced to the share normal transfers wouldn't win anyway."""
    return ChipValue(value.gain * keep_share, f"{value.reason} {note}", value.risk)


def against_normal_transfers(values, gap, normal_gain):
    """Wildcard and Free Hit values measured against normal transfers, not against doing nothing.

    `gap` is how far your squad is from the best one over the five weeks;
    `normal_gain` is how much of it the normal-transfer plan closes. The
    rest is what a chip can add. Bench Boost and Triple Captain don't
    depend on transfers, so they stay as they are.
    """
    share_left = max(0.0, 1 - normal_gain / gap) if gap > 0 else 1.0
    note = f"About {round((1 - share_left) * 100)}% of the gap would be closed by your normal transfers, so this counts the rest."
    adjusted = {}
    for chip, by_week in values.items():
        if chip in ("wildcard", "freehit"):
            adjusted[chip] = {week: scaled(value, share_left, note) for week, value in by_week.items()}
        else:
            adjusted[chip] = by_week
    return adjusted, share_left


def later_weeks(values, window_end):
    """The week after the window each chip would be saved for, sharing weeks out so no two chips land together."""
    after = {chip: {week: value for week, value in by_week.items() if week > window_end} for chip, by_week in values.items()}
    return chips.best_chip_weeks(after)


def keep_values(values, window_end):
    """What each chip is worth if saved: PLAY_SHARE of its value in its later week, plus the Wildcard margin."""
    saved_for = later_weeks(values, window_end)
    keep = {}
    for chip, by_week in values.items():
        week = saved_for.get(chip)
        keep[chip] = chips.PLAY_SHARE * by_week[week].gain if week is not None else 0.0
        if chip == "wildcard":
            keep[chip] += WILDCARD_MARGIN
    return keep


def free_hit_squads(context, weeks):
    """The best one-week squad within your budget for each week, with its lineup score and captain."""
    best = {}
    for week in weeks:
        squad = pick_best_squad(context.players, context.expected_points, week, budget=context.budget)
        lineup = best_lineup(squad, context.players_by_id, context.expected_points, week)
        best[week] = {"points": lineup["expected_points"], "squad": squad, "captain": lineup["captain"]}
    return best


def move_values(plan_weeks, players_by_id, expected_points):
    """Adds each transfer's own share of the gain: the five-week xP lost if only that move were undone."""
    weeks = [week["gameweek"] for week in plan_weeks]

    def total(squads):
        return sum(
            WEEKLY_DISCOUNT ** offset * best_lineup(squad, players_by_id, expected_points, week)["expected_points"]
            for offset, (week, squad) in enumerate(zip(weeks, squads))
        )

    squads = [week["squad"] for week in plan_weeks]
    with_all = total(squads)
    for index, week in enumerate(plan_weeks):
        for move in week["moves"]:
            undone = [
                [move["out"] if player == move["in"] else player for player in squad] if later >= index else squad
                for later, squad in enumerate(squads)
            ]
            move["value"] = round(with_all - total(undone), 2)


def played_chip_details(chip, week_entry, context, gain):
    """The reason and risk for a chip the plan plays, using the plan's own squad that week (not today's)."""
    week = week_entry["gameweek"]
    players_by_id = context.players_by_id
    if chip == "3xc":
        captain = players_by_id[week_entry["captain"]]
        matches = chips.matches_in_week(captain, context.schedule, week)
        risk = {"captainId": captain["id"], **outcome_chances(captain, context.rates_by_player[captain["id"]], matches, context.fixture_model)}
        return f"{captain['web_name']} is the plan's captain that week, so his {gain:.1f} xP counts a third time.", risk
    if chip == "bboost":
        bench = best_lineup(week_entry["squad"], players_by_id, context.expected_points, week)["bench"]
        risk = {"allBenchPlay": round(chance_all_play(bench, players_by_id, context.rates_by_player, context.schedule, week), 2)}
        return f"The plan's bench that week ({', '.join(players_by_id[p]['web_name'] for p in bench)}) is expected to add {gain:.1f} xP.", risk
    if chip == "freehit":
        return f"A one-week squad scores {gain:.1f} xP more than your own squad would that week; yours comes back the week after.", {}
    changes = len(week_entry["moves"])
    return f"The plan rebuilds {changes} players that week, worth {gain:.1f} xP more than normal transfers.", {"changes": changes}


def add_price_notes(plan_weeks, price_moves):
    """Labels moves that tonight's likely price changes affect.

    The first week's moves are assumed to be made now, before 00:00 UK;
    later weeks' prices already include the change.
    """
    for index, week in enumerate(plan_weeks):
        for move in week["moves"]:
            rise_in, fall_out = price_moves.get(move["in"]) == 1, price_moves.get(move["out"]) == -1
            notes = []
            if rise_in:
                notes.append("buy now: likely to rise £0.1m tonight" if index == 0 else "priced £0.1m higher after tonight's likely rise")
            if fall_out:
                notes.append("sell now: likely to fall £0.1m tonight" if index == 0 else "sells for less after tonight's likely fall")
            move["priceNote"] = "; ".join(notes) or None


def noisy_expected_points(expected_points, rates_by_player, rng):
    """xP with random noise, larger for players whose minutes are less certain.

    The size follows open-fpl-solver's sensitivity runs: xP times
    (92 - expected minutes) / 134 times a standard normal draw, so a
    nailed-on 90-minute player moves very little and a rotation risk a lot.
    """
    noisy = {}
    for player_id, by_week in expected_points.items():
        rates = rates_by_player.get(player_id)
        minutes = rates.chance_60_minutes * 85 + rates.chance_under_60 * 25 if rates else 45
        spread = max(0.0, 92 - minutes) / 134
        noisy[player_id] = {week: max(0.0, xp + xp * spread * rng.standard_normal()) for week, xp in by_week.items()}
    return noisy


def add_sensitivity(plan, state, players_by_id, expected_points, rates_by_player, weeks, free_hit_best, price_moves):
    """Re-solves the plan SENSITIVITY_RUNS times with noisy xP and records how often each move comes back.

    The chips stay in the weeks the plan chose, so this measures how solid
    the transfers are, not the chip decisions. Seeded by gameweek, so the
    same data gives the same numbers.
    """
    rng = numpy.random.default_rng(state.gameweek)
    fixed_chips = {chip: [week] for chip, week in plan["chips"].items()}
    first_week_moves, any_week_moves, runs = Counter(), Counter(), 0
    for _ in range(SENSITIVITY_RUNS):
        noisy = noisy_expected_points(expected_points, rates_by_player, rng)
        try:
            run = solve_transfer_plan(state, players_by_id, noisy, weeks, fixed_chips, free_hit_best, None, price_moves, SENSITIVITY_SECONDS)
        except TransferSolverError:
            continue  # a run that finds no plan in time just doesn't count
        runs += 1
        for week in run["weeks"]:
            for move in week["moves"]:
                any_week_moves[(move["out"], move["in"])] += 1
                first_week_moves[(week["gameweek"], move["out"], move["in"])] += 1
    if runs == 0:
        return
    for week in plan["weeks"]:
        for move in week["moves"]:
            move["sameWeekShare"] = round(first_week_moves[(week["gameweek"], move["out"], move["in"])] / runs, 2)
            move["anyWeekShare"] = round(any_week_moves[(move["out"], move["in"])] / runs, 2)
    first = weeks[0]
    alternatives = [
        {"out": out_id, "in": in_id, "share": round(count / runs, 2)}
        for (week, out_id, in_id), count in first_week_moves.most_common()
        if week == first and not any(m["out"] == out_id and m["in"] == in_id for m in plan["weeks"][0]["moves"])
    ][:3]
    plan["sensitivity"] = {"runs": runs, "firstWeekAlternatives": alternatives}


def chip_gain_in_plan(chip, week_entry, values, players_by_id, expected_points):
    """What a chip adds in the week the plan plays it, read straight from the plan.

    Triple Captain: the captain's xP once more. Bench Boost: the bench's xP.
    Free Hit: the one-week squad's lineup minus your own squad's that week.
    Wildcard: its value against normal transfers (see against_normal_transfers).
    """
    week = week_entry["gameweek"]
    if chip == "wildcard":
        return values["wildcard"][week].gain
    lineup = best_lineup(week_entry["squad"], players_by_id, expected_points, week)
    if chip == "3xc":
        return expected_points[week_entry["captain"]][week]
    if chip == "bboost":
        return sum(expected_points[player][week] for player in lineup["bench"])
    return week_entry["xp"] - lineup["expected_points"]


def decide(chip, played_week, values, keep, marginal, first_week, saved_for, window_end):
    """One chip's decision for the pages: play (and when), save (and for when), or nothing worth doing.

    `saved_for` is later_weeks(): each chip's week after the window, with no two chips sharing one.
    A save is a close call when a week inside the window comes within CLOSE_CALL of the saved week.
    """
    best_later = saved_for.get(chip)
    best_now = max([value.gain for week, value in values.get(chip, {}).items() if week <= window_end] or [0.0])
    decision = {
        "keepValue": round(keep.get(chip, 0.0), 1),
        "laterWeek": best_later,
        "laterGain": round(values[chip][best_later].gain, 1) if best_later is not None else None,
    }
    if played_week is not None:
        saved_worth = keep.get(chip, 0.0) - (WILDCARD_MARGIN if chip == "wildcard" else 0.0)
        decision.update(
            action="play", week=played_week, gain=round(marginal, 1),
            closeCall=marginal - saved_worth < CLOSE_CALL, playNow=played_week == first_week,
        )
    elif best_later is not None:
        decision.update(action="save", week=best_later, gain=decision["laterGain"], closeCall=best_now >= decision["laterGain"] - CLOSE_CALL, playNow=False)
    else:
        decision.update(action="none", week=None, gain=None, closeCall=False, playNow=False)
    return decision


def estimate_only(values, first_week):
    """The fallback when there's no transfer plan: the simple best-week pick for each chip."""
    picks = chips.best_chip_weeks(values, this_week=first_week)
    return {
        chip: {
            "action": "play" if picks.get(chip) is not None else "none", "week": picks.get(chip),
            "gain": round(values[chip][picks[chip]].gain, 1) if picks.get(chip) is not None else None,
            "closeCall": False, "playNow": picks.get(chip) == first_week, "keepValue": None, "laterWeek": None, "laterGain": None,
        }
        for chip in values
    }


def plan_and_chips(bootstrap, fixtures, model_results, squad_state, weeks):
    """The five-week plan (with its explanation) and every chip's decision.

    Returns (solver_plan or None, chip values by week, decisions by chip, source),
    where source is "plan" or "estimate".
    """
    first_week = squad_state.gameweek
    start, stop = chips.current_half(bootstrap, first_week)
    half_weeks = list(range(first_week, stop + 1))
    context = chips.chip_context(bootstrap, fixtures, model_results, squad_state, stop)
    available = [chip for chip in chips.VALUED_CHIPS if chips.used_in_window(squad_state.chips_used, chip, start, stop) is None]
    raw_values = chips.chip_values(available, half_weeks, squad_state, context)
    if squad_state.squad_source == "model":
        return None, raw_values, estimate_only(raw_values, first_week), "estimate"

    players_by_id, expected_points = context.players_by_id, model_results.expected_points
    try:
        price_moves = likely_price_moves(bootstrap)
        normal = solve_transfer_plan(squad_state, players_by_id, expected_points, weeks, price_moves=price_moves)
        gap = chips.wildcard_value(context, first_week).gain
        values, share_left = against_normal_transfers(raw_values, gap, normal["gain"])
        keep = keep_values(values, weeks[-1])
        chip_weeks = chips.available_chip_weeks(bootstrap, squad_state, weeks, [chip for chip in SOLVER_CHIPS if chip in available])
        free_hit_best = free_hit_squads(context, chip_weeks.get("freehit", []))
        plan = solve_transfer_plan(squad_state, players_by_id, expected_points, weeks, chip_weeks, free_hit_best, keep, price_moves)
        if not plan["chips"]:
            # No chip beats saving it, so this is the normal-transfer problem. Use that
            # plan itself: two separate solves can stop on slightly different
            # near-best answers, and the pages must show one plan, not two.
            plan = dict(normal)
    except TransferSolverError as error:
        log.warning("Chips fall back to the simple estimate: %s", error)
        return None, raw_values, estimate_only(raw_values, first_week), "estimate"

    weeks_by_number = {week["gameweek"]: week for week in plan["weeks"]}
    marginals = {
        chip: chip_gain_in_plan(chip, weeks_by_number[week], values, players_by_id, expected_points)
        for chip, week in plan["chips"].items()
    }
    move_values(plan["weeks"], players_by_id, expected_points)
    move_values(normal["weeks"], players_by_id, expected_points)
    add_price_notes(plan["weeks"], price_moves)
    add_price_notes(normal["weeks"], price_moves)
    add_sensitivity(plan, squad_state, players_by_id, expected_points, model_results.rates_by_player, weeks, free_hit_best, price_moves)
    saved_for = later_weeks({chip: by_week for chip, by_week in values.items() if chip not in plan["chips"]}, weeks[-1])
    decisions = {
        chip: decide(chip, plan["chips"].get(chip), values, keep, marginals.get(chip, 0.0), first_week, saved_for, weeks[-1])
        for chip in available
    }
    for chip, week in plan["chips"].items():
        reason, risk = played_chip_details(chip, weeks_by_number[week], context, marginals[chip])
        decisions[chip].update(planReason=reason, planRisk=risk)
    plan.update(
        normalTransfers={"weeks": normal["weeks"], "gain": normal["gain"], "totalHits": normal["totalHits"]},
        gapToBest=round(gap, 1),
        normalShareOfGap=round(1 - share_left, 2),
        wildcardMargin=WILDCARD_MARGIN,
        closeCallPoints=CLOSE_CALL,
    )
    return plan, values, decisions, "plan"


def plan_inputs_key(bootstrap, squad_state):
    """Everything that should trigger a fresh plan, as one string to compare."""
    players = {player["id"]: player for player in bootstrap["elements"]}
    return json.dumps({
        "strategyVersion": STRATEGY_VERSION,
        "gameweek": squad_state.gameweek,
        "squad": sorted(squad_state.player_ids),
        "bank": squad_state.bank,
        "freeTransfers": squad_state.free_transfers,
        "chipsUsed": sorted((chip["name"], chip["event"]) for chip in squad_state.chips_used),
        "sellingPrices": sorted(squad_state.selling_prices.items()),
        "news": [(player_id, players[player_id].get("chance_of_playing_next_round"), players[player_id].get("news")) for player_id in sorted(squad_state.player_ids)],
    }, sort_keys=True)


def values_to_json(values):
    return {chip: {str(week): vars(value) for week, value in by_week.items()} for chip, by_week in values.items()}


def values_from_json(saved):
    return {chip: {int(week): ChipValue(**value) for week, value in by_week.items()} for chip, by_week in saved.items()}


def cached_plan_and_chips(storage, bootstrap, fixtures, model_results, squad_state, weeks):
    """plan_and_chips(), reusing the last result while nothing that matters has changed."""
    name = f"strategy/{squad_state.team_id}/{squad_state.gameweek}"
    key = plan_inputs_key(bootstrap, squad_state)
    saved = storage.load_raw(name) if storage else None
    if saved and saved["key"] == key and datetime.now(timezone.utc) - datetime.fromisoformat(saved["savedAt"]) < timedelta(hours=MAX_PLAN_AGE_HOURS):
        log.info("Reusing the plan from %s (nothing that matters has changed)", saved["savedAt"])
        return saved["plan"], values_from_json(saved["values"]), saved["decisions"], saved["source"]
    plan, values, decisions, source = plan_and_chips(bootstrap, fixtures, model_results, squad_state, weeks)
    if storage:
        storage.save_raw(name, {
            "key": key, "savedAt": datetime.now(timezone.utc).isoformat(),
            "plan": plan, "values": values_to_json(values), "decisions": decisions, "source": source,
        })
    return plan, values, decisions, source
