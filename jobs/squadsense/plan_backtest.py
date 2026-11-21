"""Backtest: would following the five-week plan and chip strategy have scored more?

Each half of each downloaded past season is replayed week by week. Every
week, a manager decides using only matches played before that week, makes
that week's moves (and plays a chip if the decision says so), and scores
the real points his lineup got. Four managers are compared:

- strategy: the app's full strategy (strategy.plan_and_chips), transfers
  and chips planned together, exactly the code the website uses
- plan: the five-week transfer plan with no chips
- single: the best single transfer each week, if it beats rolling
  (planner.suggest_transfers, the older advice)
- hold: never transfers, never plays a chip

All four start each half from the same model-picked squad (nobody's real
past squads are available) with one free transfer. Real points use the
lineup and captain the model would have picked, with automatic subs and
the vice-captain stepping in, as FPL does.

Run from jobs/ (it takes a while; roughly half an hour):

    python -m squadsense.plan_backtest
"""

import argparse
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from . import rules, strategy, transfer_solver
from .chip_backtest import HALVES, SeasonForecaster, starting_squad
from .fixtures import fixtures_by_team_and_week
from .model import player_rates
from .past_seasons import load_season
from .planner import best_lineup, suggest_transfers
from .snapshot import ModelResults
from .squad_state import SquadState

WINDOW = 5
POOL_PER_POSITION = 50  # players per position the strategy may consider; keeps the backtest's squad searches quick
MANAGERS = ("strategy", "plan", "single", "hold")
CHIP_WINDOWS = [{"start_event": 1, "stop_event": 19}, {"start_event": 20, "stop_event": 38}]


@dataclass
class Manager:
    """One manager's squad, money and chips as the half goes on."""

    squad: list
    bank: int
    purchase_prices: dict
    free_transfers: int = 1
    chips_used: list = field(default_factory=list)
    points: int = 0
    chip_weeks: dict = field(default_factory=dict)
    hits: int = 0


def players_at(forecaster, week, pool_ids):
    """Player records as they stood before `week`, for everyone in the pool."""
    return {player_id: {**forecaster.player_at(player_id, week), "chance_of_playing_next_round": None} for player_id in pool_ids}


def decision_inputs(forecaster, week, last_week, manager):
    """Everything a manager needs to decide in `week`: players, xP for the window and the squad state."""
    context = forecaster.contexts[week]
    known = [player_id for player_id, rows in context.past_histories.items() if rows]
    window = [later for later in range(week, min(week + WINDOW, last_week + 1)) if later in forecaster.contexts]
    forecast = forecaster.forecast(known, week, window)
    pool = set(manager.squad)
    for position in rules.SQUAD_SHAPE:
        in_position = [p for p in known if forecaster.season.players[p]["element_type"] == position]
        in_position.sort(key=lambda p: sum(forecast[p].values()), reverse=True)
        pool.update(in_position[:POOL_PER_POSITION])
    players = players_at(forecaster, week, pool)
    selling = {p: rules.selling_price(manager.purchase_prices[p], players[p]["now_cost"]) for p in manager.squad}
    state = SquadState(
        team_id=0, gameweek=week, bank=manager.bank, free_transfers=manager.free_transfers, player_ids=list(manager.squad),
        captain_id=manager.squad[0], vice_captain_id=manager.squad[1], selling_prices=selling,
        purchase_prices=dict(manager.purchase_prices), chips_used=list(manager.chips_used), squad_source="fpl",
    )
    return players, {p: forecast[p] for p in pool}, window, state, context


def strategy_decision(forecaster, week, last_week, manager):
    """The app's strategy: this week's moves and chip from strategy.plan_and_chips()."""
    players, forecast, window, state, context = decision_inputs(forecaster, week, last_week, manager)
    bootstrap = {
        "elements": [{**player, "web_name": player.get("web_name", str(player_id)), "selected_by_percent": "0"} for player_id, player in players.items()],
        "teams": forecaster.season.teams,
        "events": [{"id": event} for event in range(1, 39)],
        "chips": CHIP_WINDOWS,
    }
    rates = {p: player_rates(players[p], context.past_histories.get(p, [])) for p in players}
    schedule = fixtures_by_team_and_week(forecaster.season.fixtures, window[0], window[-1])
    results = ModelResults(forecast, schedule, rates, context.fixture_model, {})
    plan, _, _, _ = strategy.plan_and_chips(bootstrap, forecaster.season.fixtures, results, state, window)
    first = plan["weeks"][0] if plan else {"moves": [], "chip": None, "freeHitSquad": None}
    return first["moves"], first["chip"], first["freeHitSquad"], players, forecast


def plan_decision(forecaster, week, last_week, manager):
    """The five-week plan with no chips: this week's moves."""
    players, forecast, window, state, _ = decision_inputs(forecaster, week, last_week, manager)
    plan = transfer_solver.solve_transfer_plan(state, players, forecast, window)
    return plan["weeks"][0]["moves"], None, None, players, forecast


def single_decision(forecaster, week, last_week, manager):
    """The best single transfer, if its advice is to make it rather than roll."""
    players, forecast, window, state, _ = decision_inputs(forecaster, week, last_week, manager)
    moves = suggest_transfers(state, players, forecast, window, limit=1)
    chosen = [{"out": move["out"], "in": move["in"]} for move in moves if move["advice"] == "make"]
    return chosen, None, None, players, forecast


def hold_decision(forecaster, week, last_week, manager):
    """Never transfer."""
    players, forecast, _, _, _ = decision_inputs(forecaster, week, last_week, manager)
    return [], None, None, players, forecast


DECIDERS = {"strategy": strategy_decision, "plan": plan_decision, "single": single_decision, "hold": hold_decision}


def real_points(squad, chip, players, forecast, forecaster, week):
    """Real points for the lineup the model would pick, with automatic subs, vice-captain and the chip."""
    lineup = best_lineup(squad, players, forecast, week)
    points = {p: forecaster.real_points(p, week) for p in squad}
    played = {p: any(row["round"] == week and row["minutes"] > 0 for row in forecaster.season.histories.get(p, [])) for p in squad}
    if chip == "bboost":
        counted = list(squad)
    else:
        counted = list(lineup["starters"])
        bench = list(lineup["bench"])
        for starter in [p for p in counted if not played[p]]:
            is_keeper = players[starter]["element_type"] == 1
            sub = next((p for p in bench if played[p] and (players[p]["element_type"] == 1) == is_keeper), None)
            if sub is not None:
                bench.remove(sub)
                counted[counted.index(starter)] = sub
    captain = lineup["captain"] if played[lineup["captain"]] else lineup["vice_captain"]
    extra = 2 if chip == "3xc" else 1
    return sum(points[p] for p in counted) + (extra * points[captain] if captain in counted else 0)


def apply_week(manager, moves, chip, free_hit_squad, players, forecast, forecaster, week):
    """Makes the week's moves, pays any hits, plays the chip and adds the real points."""
    if chip:
        manager.chips_used.append({"name": chip, "event": week})
        manager.chip_weeks[chip] = week
    unlimited = chip in ("wildcard", "freehit")
    for move in moves:
        sell = rules.selling_price(manager.purchase_prices.pop(move["out"]), players[move["out"]]["now_cost"])
        buy = players[move["in"]]["now_cost"]
        manager.bank += sell - buy
        manager.squad[manager.squad.index(move["out"])] = move["in"]
        manager.purchase_prices[move["in"]] = buy
    hits = 0 if unlimited else max(0, len(moves) - manager.free_transfers) * rules.POINTS_PER_EXTRA_TRANSFER
    manager.hits += hits
    # The Free Hit squad comes from the same pool, so `players` already has everyone in it.
    playing_squad = free_hit_squad if chip == "freehit" and free_hit_squad else manager.squad
    manager.points += real_points(playing_squad, chip, players, forecast, forecaster, week) - hits
    used = 0 if unlimited else len(moves)
    manager.free_transfers = min(rules.MAX_BANKED_FREE_TRANSFERS, max(0, manager.free_transfers - used) + 1)


def replay_half(forecaster, start, stop, names=MANAGERS):
    """Every manager's real points for one half of a season."""
    weeks = [week for week in range(start, stop + 1) if week in forecaster.contexts]
    squad = starting_squad(forecaster, weeks[0])
    prices = {p: forecaster.player_at(p, weeks[0])["now_cost"] for p in squad}
    managers = {name: Manager(squad=list(squad), bank=rules.STARTING_BUDGET - sum(prices.values()), purchase_prices=dict(prices)) for name in names}
    for week in weeks:
        for name, manager in managers.items():
            moves, chip, free_hit_squad, players, forecast = DECIDERS[name](forecaster, week, weeks[-1], manager)
            apply_week(manager, moves, chip, free_hit_squad, players, forecast, forecaster, week)
    return managers


def main():
    parser = argparse.ArgumentParser(description="Backtest the five-week plan and chip strategy on past seasons.")
    parser.add_argument("--past-folder", default=".data/past")
    args = parser.parse_args()
    # Faster settings than the live app: the backtest solves hundreds of plans.
    transfer_solver.SOLVER_SECONDS, transfer_solver.SOLVER_GAP = 60, 0.005
    strategy.SENSITIVITY_RUNS = 0  # the noisy re-solves only explain moves on the website

    results = {}
    for folder in sorted(Path(args.past_folder).iterdir()):
        if not folder.is_dir():
            continue
        forecaster = SeasonForecaster(load_season(folder))
        for start, stop in HALVES:
            managers = replay_half(forecaster, start, stop)
            results[f"{folder.name} {start}-{stop}"] = managers
            line = "  ".join(f"{name} {m.points} (hits {m.hits}, chips {m.chip_weeks})" for name, m in managers.items())
            print(f"{folder.name} GW{start}-{stop}: {line}", flush=True)

    print("\nReal points per half, after hits")
    print(f'{"half":14}' + "".join(f"{name:>10}" for name in MANAGERS))
    for half, managers in results.items():
        print(f"{half:14}" + "".join(f"{managers[name].points:10d}" for name in MANAGERS))
    averages = [statistics.mean(managers[name].points for managers in results.values()) for name in MANAGERS]
    print(f'{"average":14}' + "".join(f"{value:10.1f}" for value in averages))


if __name__ == "__main__":
    main()
