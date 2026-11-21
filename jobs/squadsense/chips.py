"""The Chip Planner: when to play each chip, and what it's worth.

In 2026/27 every chip comes twice: once for GW1-19 and again for GW20-38
(the windows come from bootstrap-static `chips`). This module looks at
the weeks left in the current half and, assuming you keep your current
squad, works out what each chip would add in each week:

- Bench Boost: your bench's xP that week
- Triple Captain: your best captain's xP one more time
- Free Hit: the best one-week squad within your budget, minus your own
- Wildcard: the best squad for the WILDCARD_WEEKS starting that week,
  minus keeping your own over the same weeks

FPL allows one chip per gameweek, so the plan tries every combination of
weeks and keeps the one with the biggest total gain that never puts two
chips in the same week.

Each card also says whether to play the chip now or wait (and what
waiting gains), how risky the pick is, and how rough the estimate is:
weeks more than NEAR_WEEKS away lean on fixtures more than on form.
"""

from dataclasses import dataclass, field
from itertools import product

from .captaincy import outcome_chances
from .fixtures import fixtures_by_team_and_week
from .model import expected_points_for_week
from .planner import WEEKLY_DISCOUNT, best_lineup
from .squad_builder import pick_best_squad

WILDCARD_WEEKS = 5  # how far ahead a Wildcard squad is built for
NEAR_WEEKS = 5  # weeks within the main model's window; later ones are rougher
# Play a chip now if this week is worth at least this share of the best
# week left. Waiting for the single best forecast week waited too long in
# the chip backtest (python -m squadsense.chip_backtest): over six past
# half-seasons, 0.9 lifted Triple Captain from 11.3 to 12.8 real points
# and Bench Boost from 9.3 to 14.5. Six halves is a small sample.
PLAY_SHARE = 0.9

@dataclass
class ChipValue:
    """What one chip is worth in one week, why, and how risky it is.

    `risk` holds chip-specific numbers for the page, for example the
    chance every bench player plays.
    """

    gain: float
    reason: str
    risk: dict = field(default_factory=dict)


CHIP_LABELS = {"bboost": "Bench Boost", "3xc": "Triple Captain", "freehit": "Free Hit", "wildcard": "Wildcard"}
CHIP_SHORT = {"bboost": "BB", "3xc": "TC", "freehit": "FH", "wildcard": "WC"}
VALUED_CHIPS = ("bboost", "3xc", "freehit", "wildcard")
TRANSFER_CHIPS = {"freehit", "wildcard"}
CARD_ORDER = ("bboost", "3xc", "freehit", "wildcard")


def current_half(bootstrap, week):
    """(start, stop) of the chip window that contains `week`, from the API's chip list."""
    windows = sorted({(chip["start_event"], chip["stop_event"]) for chip in bootstrap["chips"]})
    for start, stop in windows:
        if start <= week <= stop:
            return start, stop
    return windows[-1]


def horizon_expected_points(bootstrap, fixtures, model_results, weeks):
    """xP for every player in every week of the chip horizon.

    The main model only covers the next five weeks, so later weeks are
    worked out here with the same player rates and fixture model.
    """
    schedule = fixtures_by_team_and_week(fixtures, weeks[0], weeks[-1])
    return {
        player["id"]: {
            week: expected_points_for_week(
                player, model_results.rates_by_player[player["id"]], schedule[player["team"]].get(week, []),
                model_results.fixture_model,
            )
            for week in weeks
        }
        for player in bootstrap["elements"]
    }, schedule


def matches_in_week(player, schedule, week):
    return schedule[player["team"]].get(week, [])


def chance_all_play(player_ids, players_by_id, rates_by_player, schedule, week):
    """Chance every one of these players gets on the pitch, treating them as independent."""
    chance = 1.0
    for player_id in player_ids:
        if not matches_in_week(players_by_id[player_id], schedule, week):
            return 0.0
        rates = rates_by_player[player_id]
        chance *= min(1.0, rates.chance_60_minutes + rates.chance_under_60)
    return chance


def bench_boost_value(context, week):
    """Bench Boost in `week`: the bench's xP, plus the chance all four play."""
    squad_ids, players_by_id = context.squad_ids, context.players_by_id
    lineup = best_lineup(squad_ids, players_by_id, context.expected_points, week)
    gain = sum(context.expected_points[player_id][week] for player_id in lineup["bench"])
    doubles = sum(1 for player_id in squad_ids if len(matches_in_week(players_by_id[player_id], context.schedule, week)) > 1)
    reason = f"Your bench is expected to add {gain:.1f} points."
    if doubles:
        reason = f"{doubles} of your 15 play twice. " + reason
    all_play = chance_all_play(lineup["bench"], players_by_id, context.rates_by_player, context.schedule, week)
    return ChipValue(gain, reason, {"allBenchPlay": round(all_play, 2)})


def triple_captain_value(context, week):
    """Triple Captain in `week`: the captain's xP once more, plus how often he hauls."""
    lineup = best_lineup(context.squad_ids, context.players_by_id, context.expected_points, week)
    captain = context.players_by_id[lineup["captain"]]
    matches = matches_in_week(captain, context.schedule, week)
    opponents = " and ".join(
        f'{context.teams_by_id[match["opponent"]]["short_name"]} ({"H" if match["is_home"] else "A"})' for match in matches
    )
    chances = outcome_chances(captain, context.rates_by_player[captain["id"]], matches, context.fixture_model)
    return ChipValue(
        context.expected_points[captain["id"]][week],
        f'{captain["web_name"]} plays {opponents or "nobody (blank)"}.',
        {"captainId": captain["id"], **chances},
    )


def free_hit_value(context, week):
    """Free Hit in `week`: best one-week squad minus yours."""
    squad_ids, players_by_id, expected_points = context.squad_ids, context.players_by_id, context.expected_points
    own = best_lineup(squad_ids, players_by_id, expected_points, week)["expected_points"]
    free_hit_squad = pick_best_squad(context.players, expected_points, week, budget=context.budget)
    best = best_lineup(free_hit_squad, players_by_id, expected_points, week)["expected_points"]
    gain = best - own
    blanks = sum(1 for player_id in squad_ids if not matches_in_week(players_by_id[player_id], context.schedule, week))
    reason = f"A one-week squad built for this week scores {gain:.1f} more."
    if blanks:
        reason = f"{blanks} of your 15 blank. " + reason
    return ChipValue(gain, reason)


def lineup_points_over(squad_ids, players_by_id, expected_points, weeks):
    """Discounted xP of the best lineup each week, the same way the transfer plan counts it."""
    return sum(
        WEEKLY_DISCOUNT ** offset * best_lineup(squad_ids, players_by_id, expected_points, week)["expected_points"]
        for offset, week in enumerate(weeks)
    )


def wildcard_value(context, week):
    """Wildcard in `week`: the best squad for the next WILDCARD_WEEKS, minus keeping yours.

    The comparison is with making no transfers at all, so it overstates
    the gain a little: your normal free transfers would win some of it back.
    """
    weeks = [later for later in context.horizon if week <= later < week + WILDCARD_WEEKS]
    combined = {
        player_id: {"window": sum(WEEKLY_DISCOUNT ** offset * by_week[later] for offset, later in enumerate(weeks))}
        for player_id, by_week in context.expected_points.items()
    }
    new_squad = pick_best_squad(context.players, combined, "window", budget=context.budget)
    gain = (
        lineup_points_over(new_squad, context.players_by_id, context.expected_points, weeks)
        - lineup_points_over(context.squad_ids, context.players_by_id, context.expected_points, weeks)
    )
    changes = len(set(new_squad) - set(context.squad_ids))
    reason = (
        f"A squad rebuilt for GW{weeks[0]}-{weeks[-1]} ({changes} changes) scores {gain:.1f} more than keeping yours. "
        "Your normal free transfers would win back some of that."
    )
    return ChipValue(gain, reason, {"changes": changes})


@dataclass
class ChipContext:
    """Everything the chip valuations share, worked out once."""

    squad_ids: list
    players: list  # bootstrap `elements`
    players_by_id: dict
    teams_by_id: dict
    expected_points: dict  # {player_id: {week: xP}} over the whole horizon
    schedule: dict
    rates_by_player: dict
    fixture_model: object
    budget: int
    horizon: list  # every week with xP, which runs past the half for the Wildcard


CHIP_VALUERS = {"bboost": bench_boost_value, "3xc": triple_captain_value, "freehit": free_hit_value, "wildcard": wildcard_value}


def best_chip_weeks(values, this_week=None):
    """Picks a week (or none) for each chip with the biggest total gain, one chip per week.

    `values` is {chip: {week: ChipValue}}. Tries every combination,
    which is fine at this size: 4 chips and up to 19 weeks each. When
    `this_week` is given, its gains count as if divided by PLAY_SHARE, so
    a chip is played now when this week is close enough to its best.
    """
    def score(chip, week):
        gain = values[chip][week].gain
        return gain / PLAY_SHARE if week == this_week and gain > 0 else gain

    chips = list(values)
    options = [[None] + [week for week, value in values[chip].items() if value.gain > 0] for chip in chips]
    best_plan, best_total = {}, 0.0
    for weeks in product(*options):
        chosen = [week for week in weeks if week is not None]
        if len(chosen) != len(set(chosen)):
            continue  # two chips in one week isn't allowed
        total = sum(score(chip, week) for chip, week in zip(chips, weeks) if week is not None)
        if total > best_total:
            best_plan, best_total = dict(zip(chips, weeks)), total
    return best_plan


def used_in_window(chips_used, chip, start, stop):
    """The gameweek `chip` was played in this window, or None."""
    return next((played["event"] for played in chips_used if played["name"] == chip and start <= played["event"] <= stop), None)


def chip_allowed(chip, week, squad_state):
    """Free Hit and Wildcard are pointless in a team's first week, when transfers are unlimited."""
    return not (chip in TRANSFER_CHIPS and squad_state.free_transfers is None and week == squad_state.gameweek)


def available_chip_weeks(bootstrap, squad_state, weeks, chips):
    """{chip: [weeks]} for each of `chips` not yet used this half, limited to weeks it may be played in."""
    start, stop = current_half(bootstrap, squad_state.gameweek)
    return {
        chip: [week for week in weeks if week <= stop and chip_allowed(chip, week, squad_state)]
        for chip in chips
        if used_in_window(squad_state.chips_used, chip, start, stop) is None
    }


def chip_values(chips, weeks, squad_state, context):
    """{chip: {week: ChipValue}} for every chip still available."""
    return {
        chip: {week: CHIP_VALUERS[chip](context, week) for week in weeks if chip_allowed(chip, week, squad_state)}
        for chip in chips
    }


def estimate_quality(week, first_week):
    """"near" for weeks inside the main model's window, "far" for later, rougher ones (from the sixth gameweek on)."""
    return "near" if week - first_week < NEAR_WEEKS else "far"


def hold_or_play(chip_weeks, plan_week, first_week):
    """Play now or wait: the advice, this week's gain, and the single best week's.

    The plan already leans towards this week (see best_chip_weeks), so
    "play" simply means the plan chose this week.
    """
    now = chip_weeks.get(first_week)
    peak_week = max(chip_weeks, key=lambda week: chip_weeks[week].gain)
    return {
        "nowGain": round(now.gain, 1) if now else None,
        "advice": "play" if plan_week == first_week else "wait",
        "peakWeek": peak_week,
        "peakGain": round(chip_weeks[peak_week].gain, 1),
    }


def chip_card(chip, used_week, plan_week, values, half_stop, first_week):
    """One card on the page: status, best week, gain, reason, risk, hold-or-play and every week's value."""
    card = {
        "chip": chip, "label": CHIP_LABELS[chip], "status": "available", "usedIn": None,
        "bestWeek": None, "gain": None, "risk": {}, "timing": None, "quality": None, "byWeek": [],
    }
    if used_week is not None:
        card.update(status="used", usedIn=used_week)
        card["reason"] = f"Played in GW{used_week}. The next one unlocks after the GW{half_stop} deadline."
        return card
    chip_weeks = values.get(chip, {})
    card["byWeek"] = [{"gameweek": week, "gain": round(value.gain, 1)} for week, value in sorted(chip_weeks.items())]
    if plan_week is None:
        card["reason"] = "No week left in this half where it adds points to your current squad."
        return card
    value = chip_weeks[plan_week]
    card.update(
        bestWeek=plan_week, gain=round(value.gain, 1), reason=value.reason, risk=value.risk,
        timing=hold_or_play(chip_weeks, plan_week, first_week), quality=estimate_quality(plan_week, first_week),
    )
    return card


def fixture_warnings(fixtures, schedule, teams_by_id, weeks):
    """Matches that could still move, and the blank and double weeks already known.

    A match with no gameweek has been postponed and will be added to a
    later week, giving both clubs a double. A provisional kick-off time
    means the date may still change.
    """
    name = lambda team_id: teams_by_id[team_id]["short_name"]
    unscheduled = [f'{name(fixture["team_h"])} v {name(fixture["team_a"])}' for fixture in fixtures if fixture["event"] is None]
    provisional = [
        {"gameweek": fixture["event"], "match": f'{name(fixture["team_h"])} v {name(fixture["team_a"])}'}
        for fixture in fixtures
        if fixture["event"] in weeks and fixture.get("provisional_start_time")
    ]
    by_week = [
        {
            "gameweek": week,
            "blanks": sorted(name(team_id) for team_id in teams_by_id if not schedule[team_id].get(week)),
            "doubles": sorted(name(team_id) for team_id in teams_by_id if len(schedule[team_id].get(week, [])) > 1),
        }
        for week in weeks
    ]
    return {"unscheduled": unscheduled, "provisional": provisional, "weeks": [week for week in by_week if week["blanks"] or week["doubles"]]}


def season_timeline(chips_used, plan, first_week):
    """Every gameweek 1-38 with the chips played there, the ones recommended and how rough the estimate is."""
    return [
        {
            "gameweek": week,
            "used": [CHIP_SHORT[played["name"]] for played in chips_used if played["event"] == week],
            "recommended": [CHIP_SHORT[chip] for chip, plan_week in plan.items() if plan_week == week],
            "quality": estimate_quality(week, first_week) if week >= first_week else None,
        }
        for week in range(1, 39)
    ]


def chip_context(bootstrap, fixtures, model_results, squad_state, stop):
    """Builds the shared ChipContext, with xP running WILDCARD_WEEKS past the half."""
    first_week = squad_state.gameweek
    last_week = max(event["id"] for event in bootstrap["events"])
    horizon = list(range(first_week, min(stop + WILDCARD_WEEKS - 1, last_week) + 1))
    expected_points, schedule = horizon_expected_points(bootstrap, fixtures, model_results, horizon)
    return ChipContext(
        squad_ids=squad_state.player_ids,
        players=bootstrap["elements"],
        players_by_id={player["id"]: player for player in bootstrap["elements"]},
        teams_by_id={team["id"]: team for team in bootstrap["teams"]},
        expected_points=expected_points,
        schedule=schedule,
        rates_by_player=model_results.rates_by_player,
        fixture_model=model_results.fixture_model,
        budget=sum(squad_state.selling_prices.values()) + squad_state.bank,
        horizon=horizon,
    )


def build_chip_plan(bootstrap, fixtures, model_results, squad_state, solver_chips=None, rival_chips=None):
    """Everything the Chip Planner page needs, ready for the snapshot.

    `solver_chips` is {chip: week} from the five-week transfer plan, which
    plans chips and transfers together. `rival_chips` is what the
    mini-league rivals have left (see leagues.py).
    """
    first_week = squad_state.gameweek
    start, stop = current_half(bootstrap, first_week)
    weeks = list(range(first_week, stop + 1))
    context = chip_context(bootstrap, fixtures, model_results, squad_state, stop)

    used = {chip: used_in_window(squad_state.chips_used, chip, start, stop) for chip in CARD_ORDER}
    available = [chip for chip in VALUED_CHIPS if used[chip] is None]
    values = chip_values(available, weeks, squad_state, context)
    plan = best_chip_weeks(values, this_week=first_week)

    half_deadline = next(event["deadline_time"] for event in bootstrap["events"] if event["id"] == stop)
    return {
        "currentWeek": first_week,
        "halfStart": start,
        "halfStop": stop,
        "halfDeadline": half_deadline,
        "weeksLeft": len(weeks),
        "chipsLeft": sum(1 for chip in CARD_ORDER if used[chip] is None),
        "cards": [chip_card(chip, used[chip], plan.get(chip), values, stop, first_week) for chip in CARD_ORDER],
        "timeline": season_timeline(squad_state.chips_used, plan, first_week),
        "withTransfers": solver_chips or {},
        "fixtureWarnings": fixture_warnings(fixtures, context.schedule, context.teams_by_id, weeks),
        "rivals": rival_chips or [],
    }
