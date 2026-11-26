"""Rebuilds a manager's bank, selling prices and free transfers from public data.

FPL only shows the exact figures on the logged-in "my team" page. Everything
here is worked out from the public endpoints instead, so treat the results
as close estimates. They can be off when transfers have been made for a
gameweek whose deadline hasn't passed yet, because those aren't public.
"""

from dataclasses import dataclass, field

from . import rules

WILDCARD_CHIPS = {"wildcard", "freehit"}

# Assumption, roughly 70% confident: on a Wildcard or Free Hit week you keep
# your banked transfers and still get the usual +1 for the next week. If FPL
# turns out to skip the +1, set this to False.
GAIN_TRANSFER_ON_CHIP_WEEKS = True


@dataclass
class SquadState:
    """Everything the planner needs to know about a squad right now."""

    team_id: int
    gameweek: int
    bank: int
    free_transfers: int | None  # None means unlimited (a team's first gameweek)
    player_ids: list
    captain_id: int
    vice_captain_id: int
    selling_prices: dict
    purchase_prices: dict
    estimated_purchases: list = field(default_factory=list)
    chips_used: list = field(default_factory=list)
    # "fpl" when read from the team's public picks, "model" when we picked
    # it ourselves because the real squad isn't public yet.
    squad_source: str = "fpl"


def count_free_transfers(gameweek_history, chips_played, next_gameweek, started_event):
    """Replays the season week by week to find how many free transfers are banked.

    `gameweek_history` is the `current` list from entry/{id}/history/ and
    `started_event` is the team's first gameweek, from entry/{id}/. Picking
    the squad for that first week is free, then you get 1 transfer for the
    week after. A team created in GW11 starts counting from GW12, not GW2.
    """
    chip_weeks = {chip["event"] for chip in chips_played if chip["name"] in WILDCARD_CHIPS}
    transfers_by_week = {week["event"]: week["event_transfers"] for week in gameweek_history}

    free_transfers = 1
    for gameweek in range(started_event + 1, next_gameweek):
        chip = "wildcard" if gameweek in chip_weeks else None
        free_transfers = rules.next_free_transfers(
            free_transfers, transfers_by_week.get(gameweek, 0), chip, gain_on_chip_week=GAIN_TRANSFER_ON_CHIP_WEEKS,
        )
    return free_transfers


def find_purchase_prices(player_ids, transfer_log, starting_price_lookup):
    """Finds what was paid for each player currently in the squad.

    Players bought by transfer have their price in the transfer log (the
    latest purchase wins if he was bought twice). Players kept from the
    original squad aren't in the log, so we ask `starting_price_lookup`
    for their price when the squad was picked. Returns the prices and a
    list of players whose price we had to guess.
    """
    latest_purchase = {}
    for transfer in sorted(transfer_log, key=lambda item: item["event"]):
        latest_purchase[transfer["element_in"]] = transfer["element_in_cost"]

    purchase_prices = {}
    estimated = []
    for player_id in player_ids:
        if player_id in latest_purchase:
            purchase_prices[player_id] = latest_purchase[player_id]
            continue
        starting_price = starting_price_lookup(player_id)
        if starting_price is None:
            estimated.append(player_id)
        purchase_prices[player_id] = starting_price
    return purchase_prices, estimated


def build_squad_state(
    team_id, next_gameweek, started_event, picks, history, transfer_log, players_by_id, starting_price_lookup
):
    """Puts the pieces together into one SquadState.

    `started_event` is the team's first gameweek (entry/{id}/ has it),
    `picks` is the entry/{id}/event/{gw}/picks/ response for the squad to
    plan with (the week before, during a Free Hit; see sync.py),
    `history` is entry/{id}/history/ and `players_by_id` maps player id
    to the bootstrap-static player record.
    """
    player_ids = [pick["element"] for pick in picks["picks"]]
    captain_id = next(pick["element"] for pick in picks["picks"] if pick["is_captain"])
    vice_captain_id = next(pick["element"] for pick in picks["picks"] if pick["is_vice_captain"])

    # Free Hit transfers are undone the next week, so they aren't real purchases.
    free_hit_weeks = {chip["event"] for chip in history["chips"] if chip["name"] == "freehit"}
    lasting_transfers = [transfer for transfer in transfer_log if transfer["event"] not in free_hit_weeks]
    purchase_prices, estimated = find_purchase_prices(player_ids, lasting_transfers, starting_price_lookup)

    selling_prices = {}
    for player_id in player_ids:
        current_price = players_by_id[player_id]["now_cost"]
        paid = purchase_prices[player_id]
        # With no purchase price we fall back to today's price, which is
        # right for anyone whose price hasn't moved since you bought him.
        if paid is None:
            purchase_prices[player_id] = current_price
            paid = current_price
        selling_prices[player_id] = rules.selling_price(paid, current_price)

    return SquadState(
        team_id=team_id,
        gameweek=next_gameweek,
        # The picks response carries the bank for its own gameweek. The history
        # feed can be empty just after a new team's first deadline, so it isn't used.
        bank=picks["entry_history"]["bank"],
        free_transfers=count_free_transfers(history["current"], history["chips"], next_gameweek, started_event),
        player_ids=player_ids,
        captain_id=captain_id,
        vice_captain_id=vice_captain_id,
        selling_prices=selling_prices,
        purchase_prices=purchase_prices,
        estimated_purchases=estimated,
        chips_used=history["chips"],
    )


def model_squad_state(team_id, next_gameweek, player_ids, lineup, players_by_id):
    """SquadState for a squad the model picked, bought at today's prices.

    `lineup` is planner.best_lineup() for the squad. Nothing has been
    bought yet, so selling prices are today's prices and the bank is
    whatever the budget has left. Free transfers are None because
    changes are unlimited until a team's first deadline.
    """
    prices = {player_id: players_by_id[player_id]["now_cost"] for player_id in player_ids}
    return SquadState(
        team_id=team_id,
        gameweek=next_gameweek,
        bank=rules.STARTING_BUDGET - sum(prices.values()),
        free_transfers=None,
        player_ids=player_ids,
        captain_id=lineup["captain"],
        vice_captain_id=lineup["vice_captain"],
        selling_prices=prices,
        purchase_prices=dict(prices),
        squad_source="model",
    )


def mark_fits(state, move, players_by_id):
    """True when the marked player out is in the squad, the player in isn't, and both play the same position.

    The website checks marks before saving them; this is the backstop,
    since any transfer can be marked, not only the plan's.
    """
    out, into = players_by_id.get(move["out"]), players_by_id.get(move["in"])
    if out is None or into is None or out["element_type"] != into["element_type"]:
        return False
    return move["out"] in state.player_ids and move["in"] not in state.player_ids


def apply_made_moves(state, moves, players_by_id):
    """The squad after the transfers Clement marked "Done on FPL", which FPL keeps hidden until the deadline.

    `moves` are {"gameweek", "out", "in", "priceIn"} rows from the
    made_moves table, for the gameweek being planned. Each one swaps the
    players, pays `priceIn` from the bank, gets the old player's selling
    price back and uses a free transfer (never below 0; an unlimited week
    stays unlimited). A mark that doesn't fit the squad, for example
    because the public squad has changed since, is skipped.
    Returns (new state, applied marks, skipped marks).
    """
    applied, skipped = [], []
    for move in moves:
        if not mark_fits(state, move, players_by_id):
            skipped.append(move)
            continue
        out, into, price = move["out"], move["in"], move["priceIn"]
        state.player_ids = [into if player_id == out else player_id for player_id in state.player_ids]
        state.bank += state.selling_prices.pop(out) - price
        state.purchase_prices.pop(out, None)
        state.purchase_prices[into] = price
        state.selling_prices[into] = rules.selling_price(price, players_by_id[into]["now_cost"])
        if state.free_transfers is not None:
            state.free_transfers = max(0, state.free_transfers - 1)
        state.captain_id = into if state.captain_id == out else state.captain_id
        state.vice_captain_id = into if state.vice_captain_id == out else state.vice_captain_id
        applied.append(move)
    return state, applied, skipped


def marked_move_mismatches(moves, real_player_ids):
    """Marked moves whose new player isn't in the real squad FPL showed after the deadline."""
    return [move for move in moves if move["in"] not in real_player_ids]
