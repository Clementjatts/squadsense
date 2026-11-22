"""FPL game rules for 2026/27, kept in one place.

Prices are stored the way FPL stores them: in tenths of a million,
so 145 means £14.5m. Doing the maths in whole numbers avoids rounding
surprises like 0.1 + 0.2 = 0.30000000000000004.
"""

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

# FPL scoring. These have been stable for years, but if FPL changes them
# mid-season this is the one table to update.
POINTS_FOR_GOAL = {GOALKEEPER: 10, DEFENDER: 6, MIDFIELDER: 5, FORWARD: 4}
POINTS_FOR_CLEAN_SHEET = {GOALKEEPER: 4, DEFENDER: 4, MIDFIELDER: 1, FORWARD: 0}
POINTS_FOR_ASSIST = 3
POINTS_FOR_60_MINUTES = 2
POINTS_FOR_UNDER_60_MINUTES = 1
POINTS_FOR_DEFENSIVE_CONTRIBUTION = 2
# Defensive actions needed in one match to earn the 2 points.
DEFENSIVE_CONTRIBUTION_THRESHOLD = {GOALKEEPER: None, DEFENDER: 10, MIDFIELDER: 12, FORWARD: 12}


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
