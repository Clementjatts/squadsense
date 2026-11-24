"""FPL game rules for 2026/27, kept in one place.

The values below are the 2026/27 rules typed in. Each sync replaces the
ones FPL publishes (scoring, club limit, budget, banked transfers, squad
and lineup shape) with FPL's own, through apply_fpl_settings, so a rule
FPL changes mid-season is picked up straight away. Past seasons and test
data don't carry these settings, so they use the typed-in values.

Prices are stored the way FPL stores them: in tenths of a million,
so 145 means £14.5m. Doing the maths in whole numbers avoids rounding
surprises like 0.1 + 0.2 = 0.30000000000000004.
"""

import copy
from collections import Counter

GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD = 1, 2, 3, 4
POSITION_NAMES = {GOALKEEPER: "GK", DEFENDER: "DEF", MIDFIELDER: "MID", FORWARD: "FWD"}

STARTING_BUDGET = 1000  # £100.0m
SQUAD_SHAPE = {GOALKEEPER: 2, DEFENDER: 5, MIDFIELDER: 5, FORWARD: 3}
MAX_PER_CLUB = 3
MAX_BANKED_FREE_TRANSFERS = 5
POINTS_PER_EXTRA_TRANSFER = 4

# Minimum players per position in the starting eleven.
MIN_STARTERS = {GOALKEEPER: 1, DEFENDER: 3, MIDFIELDER: 2, FORWARD: 1}
MAX_STARTERS = {GOALKEEPER: 1, DEFENDER: 5, MIDFIELDER: 5, FORWARD: 3}

# FPL scoring.
POINTS_FOR_GOAL = {GOALKEEPER: 10, DEFENDER: 6, MIDFIELDER: 5, FORWARD: 4}
POINTS_FOR_CLEAN_SHEET = {GOALKEEPER: 4, DEFENDER: 4, MIDFIELDER: 1, FORWARD: 0}
POINTS_FOR_ASSIST = 3
POINTS_FOR_60_MINUTES = 2
POINTS_FOR_UNDER_60_MINUTES = 1
POINTS_FOR_DEFENSIVE_CONTRIBUTION = {GOALKEEPER: 0, DEFENDER: 2, MIDFIELDER: 2, FORWARD: 2}
# Defensive actions needed in one match to earn the 2 points.
DEFENSIVE_CONTRIBUTION_THRESHOLD = {GOALKEEPER: None, DEFENDER: 10, MIDFIELDER: 12, FORWARD: 12}


# How FPL names positions in its scoring table.
FPL_POSITION_KEYS = {GOALKEEPER: "GKP", DEFENDER: "DEF", MIDFIELDER: "MID", FORWARD: "FWD"}
# The values apply_fpl_settings may replace, and their typed-in defaults.
FPL_SETTING_NAMES = (
    "STARTING_BUDGET", "SQUAD_SHAPE", "MAX_PER_CLUB", "MAX_BANKED_FREE_TRANSFERS", "MIN_STARTERS", "MAX_STARTERS",
    "POINTS_FOR_GOAL", "POINTS_FOR_CLEAN_SHEET", "POINTS_FOR_ASSIST", "POINTS_FOR_60_MINUTES",
    "POINTS_FOR_UNDER_60_MINUTES", "POINTS_FOR_DEFENSIVE_CONTRIBUTION",
)
DEFAULTS = {name: copy.deepcopy(globals()[name]) for name in FPL_SETTING_NAMES}


def use_defaults():
    """Puts every value apply_fpl_settings can change back to the typed-in default."""
    for name, value in DEFAULTS.items():
        globals()[name] = copy.deepcopy(value)


def scoring_values(scoring):
    """(label, setting, position or None, value) for each point value in FPL's scoring table."""
    found = [
        ("Points for 60+ minutes", "POINTS_FOR_60_MINUTES", None, scoring.get("long_play")),
        ("Points for under 60 minutes", "POINTS_FOR_UNDER_60_MINUTES", None, scoring.get("short_play")),
        ("Points for an assist", "POINTS_FOR_ASSIST", None, scoring.get("assists")),
    ]
    by_position = (
        ("goal", "POINTS_FOR_GOAL", "goals_scored"),
        ("clean sheet", "POINTS_FOR_CLEAN_SHEET", "clean_sheets"),
        ("defensive contribution", "POINTS_FOR_DEFENSIVE_CONTRIBUTION", "defensive_contribution"),
    )
    for position, key in FPL_POSITION_KEYS.items():
        for what, setting, field in by_position:
            found.append((f"Points for a {key} {what}", setting, position, (scoring.get(field) or {}).get(key)))
    return found


def squad_values(settings, element_types):
    """(label, setting, position or None, value) for the club limit, budget, banking and squad shape."""
    extra = settings.get("max_extra_free_transfers")
    found = [
        ("Players allowed from one club", "MAX_PER_CLUB", None, settings.get("squad_team_limit")),
        ("Starting budget", "STARTING_BUDGET", None, settings.get("squad_total_spend")),
        ("Free transfers you can bank", "MAX_BANKED_FREE_TRANSFERS", None, None if extra is None else 1 + extra),
    ]
    for kind in element_types:
        name = POSITION_NAMES.get(kind.get("id"), kind.get("id"))
        found += [
            (f"{name} in a squad", "SQUAD_SHAPE", kind.get("id"), kind.get("squad_select")),
            (f"Fewest {name} in a lineup", "MIN_STARTERS", kind.get("id"), kind.get("squad_min_play")),
            (f"Most {name} in a lineup", "MAX_STARTERS", kind.get("id"), kind.get("squad_max_play")),
        ]
    return found


def apply_fpl_settings(bootstrap):
    """Uses FPL's published scoring and squad rules for this sync. Returns how they differ from the defaults.

    Each difference reads like "Points for a MID goal: 5 now 6". A value
    FPL leaves out (or sets to None) keeps its default.
    """
    scoring = (bootstrap.get("game_config") or {}).get("scoring") or {}
    found = scoring_values(scoring) + squad_values(bootstrap.get("game_settings") or {}, bootstrap.get("element_types") or [])
    differences = []
    for label, setting, position, value in found:
        if value is None:
            continue
        default = DEFAULTS[setting] if position is None else DEFAULTS[setting].get(position)
        if position is None:
            globals()[setting] = value
        else:
            globals()[setting][position] = value
        if value != default:
            differences.append(f"{label}: {default} now {value}")
    return differences


def selling_price(purchase_price, current_price):
    """Works out what FPL pays you when you sell a player.

    If his price went up, you keep half the rise, rounded down to the
    nearest £0.1m. If it went down, you take the full drop.
    """
    if current_price <= purchase_price:
        return current_price
    profit = current_price - purchase_price
    return purchase_price + profit // 2


UNLIMITED_TRANSFER_CHIPS = ("wildcard", "freehit")


def hit_points(transfers_made, free_transfers, chip=None):
    """Points taken off for transfers beyond the free ones.

    `free_transfers` is None in a team's first week, when transfers are
    unlimited. Wildcard and Free Hit weeks are unlimited too. Mirrored by
    hitPoints in web/lib/planning.ts; shared/rule-cases.json tests both.
    """
    if free_transfers is None or chip in UNLIMITED_TRANSFER_CHIPS:
        return 0
    return max(0, transfers_made - free_transfers) * POINTS_PER_EXTRA_TRANSFER


def next_free_transfers(free_transfers, transfers_made, chip=None, gain_on_chip_week=True):
    """Free transfers for the following week.

    After an unlimited first week you have 1. A Wildcard or Free Hit week
    keeps the banked ones and, by default, still adds one. Otherwise you
    keep what you didn't use (never below zero, since extra transfers are
    paid for in points) plus one, up to MAX_BANKED_FREE_TRANSFERS.
    Mirrored by nextFreeTransfers in web/lib/planning.ts.
    """
    if free_transfers is None:
        return 1
    if chip in UNLIMITED_TRANSFER_CHIPS:
        banked = free_transfers + (1 if gain_on_chip_week else 0)
    else:
        banked = max(0, free_transfers - transfers_made) + 1
    return min(banked, MAX_BANKED_FREE_TRANSFERS)


def clubs_over_limit(clubs):
    """{club: count} for every club with more than MAX_PER_CLUB players in `clubs`.

    Mirrored by clubsOverLimit in web/lib/planning.ts.
    """
    return {club: count for club, count in Counter(clubs).items() if count > MAX_PER_CLUB}


def check_squad(players, bank):
    """Checks a 15-man squad against the hard rules.

    `players` is a list of dicts with `element_type`, `team` and
    `selling_price`. Returns a list of problems in plain English; an
    empty list means the squad is legal.
    """
    problems = []
    if bank < 0:
        problems.append(f"Over budget by £{-bank / 10:.1f}m")

    position_counts = Counter(player["element_type"] for player in players)
    for position, needed in SQUAD_SHAPE.items():
        if position_counts.get(position, 0) != needed:
            problems.append(
                f"Need {needed} {POSITION_NAMES[position]}, have {position_counts.get(position, 0)}"
            )

    for club, count in clubs_over_limit(player["team"] for player in players).items():
        problems.append(f"{count} players from club {club}, the limit is {MAX_PER_CLUB}")

    return problems


def is_valid_formation(starters):
    """True if eleven starters fit FPL's formation rules."""
    if len(starters) != 11:
        return False
    counts = Counter(player["element_type"] for player in starters)
    for position in SQUAD_SHAPE:
        if not MIN_STARTERS[position] <= counts.get(position, 0) <= MAX_STARTERS[position]:
            return False
    return True
