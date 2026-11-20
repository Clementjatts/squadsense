"""Lineup, captain and transfer decisions built on top of the xP numbers.

`expected_points` everywhere below is a dict of
{player_id: {gameweek: xP}} produced by the model.
"""

from collections import Counter

from . import rules

WEEKLY_DISCOUNT = 0.9  # later weeks are less certain, so they count less
CANDIDATES_PER_POSITION = 25  # only the best options are worth testing


def roll_value(free_transfers):
    """Rough worth, in points, of saving this week's free transfer.

    Starting assumption: saving matters most when you have few banked,
    and is worth nothing at 5 because a sixth would be wasted.
    """
    return {0: 1.5, 1: 1.5, 2: 1.5, 3: 1.0, 4: 0.5}.get(free_transfers, 0.0)


def best_lineup(player_ids, players_by_id, expected_points, gameweek):
    """Picks the highest-scoring legal eleven, bench order and captain for one week.

    Fills the minimum for each position first (1 GK, 3 DEF, 2 MID, 1 FWD),
    then takes the best remaining outfield players up to each maximum.
    """
    def xp(player_id):
        return expected_points.get(player_id, {}).get(gameweek, 0.0)

    by_position = {position: [] for position in rules.SQUAD_SHAPE}
    for player_id in sorted(player_ids, key=xp, reverse=True):
        by_position[players_by_id[player_id]["element_type"]].append(player_id)

    starters = []
    for position, minimum in rules.MIN_STARTERS.items():
        starters.extend(by_position[position][:minimum])

    leftovers = sorted(
        (player_id for player_id in player_ids if player_id not in starters
         and players_by_id[player_id]["element_type"] != rules.GOALKEEPER),
        key=xp,
        reverse=True,
    )
    for player_id in leftovers:
        if len(starters) == 11:
            break
        position = players_by_id[player_id]["element_type"]
        if Counter(players_by_id[starter]["element_type"] for starter in starters)[position] < rules.MAX_STARTERS[position]:
            starters.append(player_id)

    bench_goalkeeper = [player_id for player_id in by_position[rules.GOALKEEPER] if player_id not in starters]
    bench_outfield = [player_id for player_id in leftovers if player_id not in starters]
    ranked_starters = sorted(starters, key=xp, reverse=True)

    return {
        "starters": starters,
        "bench": bench_goalkeeper + bench_outfield,
        "captain": ranked_starters[0],
        "vice_captain": ranked_starters[1],
        # The captain's points count twice, so add his xP once more.
        "expected_points": round(sum(xp(player_id) for player_id in starters) + xp(ranked_starters[0]), 2),
    }


def squad_points_over_window(player_ids, players_by_id, expected_points, gameweeks):
    """Total xP of the best lineup each week, with later weeks discounted."""
    total = 0.0
    for offset, gameweek in enumerate(gameweeks):
        lineup = best_lineup(player_ids, players_by_id, expected_points, gameweek)
        total += (WEEKLY_DISCOUNT ** offset) * lineup["expected_points"]
    return total


def transfer_is_legal(squad_ids, out_id, in_id, players_by_id, bank, selling_prices):
    """Checks one swap against budget, position and club limit.

    Returns (is_legal, bank_after).
    """
    player_out, player_in = players_by_id[out_id], players_by_id[in_id]
    if in_id in squad_ids or player_out["element_type"] != player_in["element_type"]:
        return False, bank
    bank_after = bank + selling_prices[out_id] - player_in["now_cost"]
    if bank_after < 0:
        return False, bank
    clubs_after = Counter(players_by_id[player_id]["team"] for player_id in squad_ids if player_id != out_id)
    if clubs_after[player_in["team"]] >= rules.MAX_PER_CLUB:
        return False, bank
    return True, bank_after


def suggest_transfers(squad_state, players_by_id, expected_points, gameweeks, limit=5):
    """Finds the best single transfers over the planning window.

    For every player in the squad, tries the top candidates in his
    position and measures how much the best lineup improves. Returns the
    best moves with the "make it now or roll" comparison attached.
    """
    squad_ids = squad_state.player_ids
    baseline = squad_points_over_window(squad_ids, players_by_id, expected_points, gameweeks)

    def window_xp(player_id):
        return sum(expected_points.get(player_id, {}).get(week, 0.0) for week in gameweeks)

    candidates_by_position = {}
    for position in rules.SQUAD_SHAPE:
        pool = [player for player in players_by_id.values()
                if player["element_type"] == position and player["id"] not in squad_ids]
        pool.sort(key=lambda player: window_xp(player["id"]), reverse=True)
        candidates_by_position[position] = [player["id"] for player in pool[:CANDIDATES_PER_POSITION]]

    moves = []
    for out_id in squad_ids:
        for in_id in candidates_by_position[players_by_id[out_id]["element_type"]]:
            legal, bank_after = transfer_is_legal(
                squad_ids, out_id, in_id, players_by_id, squad_state.bank, squad_state.selling_prices
            )
            if not legal:
                continue
            new_squad = [in_id if player_id == out_id else player_id for player_id in squad_ids]
            gain = squad_points_over_window(new_squad, players_by_id, expected_points, gameweeks) - baseline
            if gain > 0:
                moves.append({"out": out_id, "in": in_id, "gain": round(gain, 2), "bank_after": bank_after})

    moves.sort(key=lambda move: move["gain"], reverse=True)
    best = moves[:limit]
    for move in best:
        add_hit_or_roll_advice(move, squad_state.free_transfers)
    return best


def add_hit_or_roll_advice(move, free_transfers):
    """Adds the hit cost and the "make it or roll it" verdict to a move."""
    hit_cost = 0 if free_transfers >= 1 else rules.POINTS_PER_EXTRA_TRANSFER
    keep_value = roll_value(free_transfers)
    move["hit_cost"] = hit_cost
    move["roll_value"] = keep_value
    move["net_gain"] = round(move["gain"] - hit_cost - keep_value, 2)
    move["advice"] = "make" if move["net_gain"] > 0 else "roll"
