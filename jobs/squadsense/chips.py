"""The Chip Planner: when to play each chip, and what it's worth.

In 2026/27 every chip comes twice: once for GW1-19 and again for GW20-38
(the windows come from bootstrap-static `chips`). This module looks at
the weeks left in the current half and, assuming you keep your current
squad, works out what each chip would add in each week:

- Bench Boost: your bench's xP that week
- Triple Captain: your best captain's xP one more time
- Free Hit: the best one-week squad within your budget, minus your own

FPL allows one chip per gameweek, so the plan tries every combination of
weeks and keeps the one with the biggest total gain that never puts two
chips in the same week. The Wildcard gets no number: its value comes from
rebuilding over several weeks, which the model can't measure yet.
"""

from itertools import product

from .fixtures import fixtures_by_team_and_week
from .model import expected_points_for_week
from .planner import best_lineup
from .squad_builder import pick_best_squad

CHIP_LABELS = {"bboost": "Bench Boost", "3xc": "Triple Captain", "freehit": "Free Hit", "wildcard": "Wildcard"}
CHIP_SHORT = {"bboost": "BB", "3xc": "TC", "freehit": "FH", "wildcard": "WC"}
VALUED_CHIPS = ("bboost", "3xc", "freehit")
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


def bench_boost_value(squad_ids, players_by_id, expected_points, schedule, week):
    """(gain, reason) for playing Bench Boost in `week`."""
    lineup = best_lineup(squad_ids, players_by_id, expected_points, week)
    gain = sum(expected_points[player_id][week] for player_id in lineup["bench"])
    doubles = sum(1 for player_id in squad_ids if len(matches_in_week(players_by_id[player_id], schedule, week)) > 1)
    reason = f"Your bench is expected to add {gain:.1f} points."
    if doubles:
        reason = f"{doubles} of your 15 play twice. " + reason
    return gain, reason


def triple_captain_value(squad_ids, players_by_id, expected_points, schedule, teams_by_id, week):
    """(gain, reason) for playing Triple Captain in `week`."""
    lineup = best_lineup(squad_ids, players_by_id, expected_points, week)
    captain = players_by_id[lineup["captain"]]
    opponents = " and ".join(
        f'{teams_by_id[match["opponent"]]["short_name"]} ({"H" if match["is_home"] else "A"})'
        for match in matches_in_week(captain, schedule, week)
    )
    return expected_points[captain["id"]][week], f'{captain["web_name"]} plays {opponents or "nobody (blank)"}.'


def free_hit_value(squad_ids, players, players_by_id, expected_points, schedule, budget, week):
    """(gain, reason) for playing Free Hit in `week`: best one-week squad minus yours."""
    own = best_lineup(squad_ids, players_by_id, expected_points, week)["expected_points"]
    free_hit_squad = pick_best_squad(players, expected_points, week, budget=budget)
    best = best_lineup(free_hit_squad, players_by_id, expected_points, week)["expected_points"]
    gain = best - own
    blanks = sum(1 for player_id in squad_ids if not matches_in_week(players_by_id[player_id], schedule, week))
    reason = f"A one-week squad built for this week scores {gain:.1f} more."
    if blanks:
        reason = f"{blanks} of your 15 blank. " + reason
    return gain, reason


def best_chip_weeks(values):
    """Picks a week (or none) for each chip with the biggest total gain, one chip per week.

    `values` is {chip: {week: (gain, reason)}}. Tries every combination,
    which is fine at this size: 3 chips and up to 19 weeks each.
    """
    chips = list(values)
    options = [[None] + [week for week, (gain, _) in values[chip].items() if gain > 0] for chip in chips]
    best_plan, best_total = {}, 0.0
    for weeks in product(*options):
        chosen = [week for week in weeks if week is not None]
        if len(chosen) != len(set(chosen)):
            continue  # two chips in one week isn't allowed
        total = sum(values[chip][week][0] for chip, week in zip(chips, weeks) if week is not None)
        if total > best_total:
            best_plan, best_total = dict(zip(chips, weeks)), total
    return best_plan


def used_in_window(chips_used, chip, start, stop):
    """The gameweek `chip` was played in this window, or None."""
    return next((played["event"] for played in chips_used if played["name"] == chip and start <= played["event"] <= stop), None)


def chip_allowed(chip, week, squad_state):
    """Free Hit and Wildcard are pointless in a team's first week, when transfers are unlimited."""
    return not (chip in TRANSFER_CHIPS and squad_state.free_transfers is None and week == squad_state.gameweek)


def chip_values(chips, weeks, squad_state, bootstrap, expected_points, schedule):
    """{chip: {week: (gain, reason)}} for every chip still available."""
    players_by_id = {player["id"]: player for player in bootstrap["elements"]}
    teams_by_id = {team["id"]: team for team in bootstrap["teams"]}
    squad_ids = squad_state.player_ids
    budget = sum(squad_state.selling_prices.values()) + squad_state.bank
    values = {}
    for chip in chips:
        values[chip] = {}
        for week in weeks:
            if not chip_allowed(chip, week, squad_state):
                continue
            if chip == "bboost":
                values[chip][week] = bench_boost_value(squad_ids, players_by_id, expected_points, schedule, week)
            elif chip == "3xc":
                values[chip][week] = triple_captain_value(squad_ids, players_by_id, expected_points, schedule, teams_by_id, week)
            else:
                values[chip][week] = free_hit_value(
                    squad_ids, bootstrap["elements"], players_by_id, expected_points, schedule, budget, week
                )
    return values


def chip_card(chip, used_week, plan_week, values, half_stop):
    """One card on the page: status, best week, expected gain and a reason."""
    card = {"chip": chip, "label": CHIP_LABELS[chip], "status": "available", "usedIn": None, "bestWeek": None, "gain": None}
    if used_week is not None:
        card.update(status="used", usedIn=used_week)
        card["reason"] = f"Played in GW{used_week}. The next one unlocks after the GW{half_stop} deadline."
    elif chip == "wildcard":
        card["reason"] = "No best week from the model. Its value is in rebuilding over several weeks, which it can't measure yet."
    elif plan_week is None:
        card["reason"] = "No week left in this half where it adds points to your current squad."
    else:
        gain, reason = values[chip][plan_week]
        card.update(bestWeek=plan_week, gain=round(gain, 1), reason=reason)
    return card


def season_timeline(chips_used, plan):
    """Every gameweek 1-38 with the chips played there and the ones recommended."""
    return [
        {
            "gameweek": week,
            "used": [CHIP_SHORT[played["name"]] for played in chips_used if played["event"] == week],
            "recommended": [CHIP_SHORT[chip] for chip, plan_week in plan.items() if plan_week == week],
        }
        for week in range(1, 39)
    ]


def build_chip_plan(bootstrap, fixtures, model_results, squad_state):
    """Everything the Chip Planner page needs, ready for the snapshot."""
    first_week = squad_state.gameweek
    start, stop = current_half(bootstrap, first_week)
    weeks = list(range(first_week, stop + 1))
    expected_points, schedule = horizon_expected_points(bootstrap, fixtures, model_results, weeks)

    used = {chip: used_in_window(squad_state.chips_used, chip, start, stop) for chip in CARD_ORDER}
    available = [chip for chip in VALUED_CHIPS if used[chip] is None]
    values = chip_values(available, weeks, squad_state, bootstrap, expected_points, schedule)
    plan = best_chip_weeks(values)

    half_deadline = next(event["deadline_time"] for event in bootstrap["events"] if event["id"] == stop)
    return {
        "currentWeek": first_week,
        "halfStart": start,
        "halfStop": stop,
        "halfDeadline": half_deadline,
        "weeksLeft": len(weeks),
        "chipsLeft": sum(1 for chip in CARD_ORDER if used[chip] is None),
        "cards": [chip_card(chip, used[chip], plan.get(chip), values, stop) for chip in CARD_ORDER],
        "timeline": season_timeline(squad_state.chips_used, plan),
    }
