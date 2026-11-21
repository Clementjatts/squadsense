"""Runs the model and packs the results into one JSON "snapshot" for the website.

The website never does maths on raw FPL data. It reads the latest
snapshot and shows it. That keeps pages fast and means the Python model
is the only place the logic lives (apart from the planner's live budget
checks, which have to run in the browser as you click).
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from . import flags, planner, rules
from .chips import build_chip_plan
from .fixtures import FixtureModel, fixtures_by_team_and_week, team_ratings
from .model import expected_points_for_week, player_rates
from .player_detail import build_player_details, recent_gameweeks
from .price_watch import build_price_watch
from .ticker import build_ticker

MODEL_VERSION = "v2"  # v2: assist factor and forward bonus from the backtest
PLANNING_WINDOW = 5
CANDIDATES_IN_SNAPSHOT = 30  # per position, for the planner's search table


@dataclass
class ModelResults:
    """What run_model() works out, kept together so build_snapshot() can reuse it."""

    expected_points: dict  # {player_id: {gameweek: xP}}
    schedule: dict  # {team_id: {gameweek: [match, ...]}}
    rates_by_player: dict  # {player_id: PlayerRates}
    fixture_model: FixtureModel


def run_model(bootstrap, fixtures, histories, first_week):
    """Works out xP for every player for the next PLANNING_WINDOW gameweeks."""
    last_week = first_week + PLANNING_WINDOW - 1
    fixture_model = FixtureModel(team_ratings(bootstrap["teams"], fixtures, histories))
    schedule = fixtures_by_team_and_week(fixtures, first_week, last_week)

    expected_points = {}
    rates_by_player = {}
    for player in bootstrap["elements"]:
        rates = player_rates(player, histories.get(player["id"], []))
        rates_by_player[player["id"]] = rates
        expected_points[player["id"]] = {
            week: expected_points_for_week(player, rates, schedule[player["team"]].get(week, []), fixture_model)
            for week in range(first_week, last_week + 1)
        }

    return ModelResults(expected_points, schedule, rates_by_player, fixture_model)


def captain_safety(chance_60_minutes):
    """Turns the chance of playing 60+ minutes into a short label."""
    if chance_60_minutes >= 0.9:
        return "Very safe"
    if chance_60_minutes >= 0.75:
        return "Safe"
    return "Some risk"


def describe_player(player, teams_by_id, expected_points, weeks, history_rows, selling_price=None):
    """The fields the website shows for one player.

    `form` is his points in each of his club's last six gameweeks, for the
    Dashboard's form sparkline.
    """
    return {
        "id": player["id"],
        "name": player["web_name"],
        "team": teams_by_id[player["team"]]["short_name"],
        "teamId": player["team"],
        "position": rules.POSITION_NAMES[player["element_type"]],
        "price": player["now_cost"],
        "sellingPrice": selling_price if selling_price is not None else player["now_cost"],
        "ownership": float(player["selected_by_percent"]),
        "chance": player.get("chance_of_playing_next_round"),
        "news": player.get("news") or "",
        "yellowCards": player.get("yellow_cards", 0),
        "netTransfersToday": player["transfers_in_event"] - player["transfers_out_event"],
        "xp": {str(week): expected_points[player["id"]][week] for week in weeks},
        "windowXp": round(sum(expected_points[player["id"]][week] for week in weeks), 2),
        "form": [week["points"] for week in recent_gameweeks(history_rows)],
    }


def collect_flags(squad_ids, players_by_id, histories, fixtures):
    """Injury, suspension and rotation warnings for players in the squad."""
    matches_played = flags.club_matches_played(fixtures)
    warnings = []
    for player_id in squad_ids:
        player = players_by_id[player_id]
        checks = [
            ("injury", flags.injury_flag(player)),
            ("suspension", flags.suspension_flag(player, matches_played.get(player["team"], 0))),
            ("rotation", flags.rotation_flag(histories.get(player_id, []))),
        ]
        for kind, message in checks:
            if message:
                warnings.append({"playerId": player_id, "kind": kind, "message": message})
    return warnings


def transfer_suggestions(squad_state, players_by_id, expected_points, weeks):
    """Best single transfers, or none for a squad the model just picked.

    A model-picked squad is already the best one for the coming week, and
    it isn't a squad you own, so suggesting changes to it would mislead.
    """
    if squad_state.squad_source == "model":
        return []
    return planner.suggest_transfers(squad_state, players_by_id, expected_points, weeks)


def build_snapshot(bootstrap, fixtures, histories, model_results, squad_state, team_entry):
    """Builds the full snapshot the website reads.

    `model_results` is what run_model() returned for the same first week.
    """
    first_week = squad_state.gameweek
    weeks = list(range(first_week, first_week + PLANNING_WINDOW))
    expected_points = model_results.expected_points
    schedule = model_results.schedule
    rates_by_player = model_results.rates_by_player

    players_by_id = {player["id"]: player for player in bootstrap["elements"]}
    teams_by_id = {team["id"]: team for team in bootstrap["teams"]}
    squad_ids = squad_state.player_ids

    # Squad players plus the best options per position for the planner.
    included_ids = set(squad_ids)
    for position in rules.SQUAD_SHAPE:
        pool = sorted(
            (player for player in bootstrap["elements"] if player["element_type"] == position),
            key=lambda player: sum(expected_points[player["id"]][week] for week in weeks),
            reverse=True,
        )
        included_ids.update(player["id"] for player in pool[:CANDIDATES_IN_SNAPSHOT])

    players = {
        str(player_id): describe_player(
            players_by_id[player_id], teams_by_id, expected_points, weeks,
            histories.get(player_id, []), squad_state.selling_prices.get(player_id),
        )
        for player_id in included_ids
    }

    lineups = {str(week): planner.best_lineup(squad_ids, players_by_id, expected_points, week) for week in weeks}
    this_week = lineups[str(first_week)]
    captain_options = sorted(this_week["starters"], key=lambda pid: expected_points[pid][first_week], reverse=True)[:5]

    next_event = next(event for event in bootstrap["events"] if event["id"] == first_week)
    price_watch = build_price_watch(bootstrap, set(squad_ids), rules.POSITION_NAMES)
    ticker = build_ticker(model_results.fixture_model, fixtures, bootstrap["teams"], first_week)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "modelVersion": MODEL_VERSION,
        "team": {
            "id": squad_state.team_id,
            "name": team_entry["name"],
            "manager": f'{team_entry["player_first_name"]} {team_entry["player_last_name"]}',
        },
        "gameweek": first_week,
        "deadline": next_event["deadline_time"],
        "weeks": weeks,
        "bank": squad_state.bank,
        "freeTransfers": squad_state.free_transfers,
        "squadValue": sum(squad_state.selling_prices.values()) + squad_state.bank,
        "estimatedFromPublicData": True,
        "squad": squad_ids,
        "players": players,
        "lineups": lineups,
        "captainOptions": [
            {
                "playerId": player_id,
                "xp": expected_points[player_id][first_week],
                "safety": captain_safety(rates_by_player[player_id].chance_60_minutes),
                "chance60": round(rates_by_player[player_id].chance_60_minutes, 2),
            }
            for player_id in captain_options
        ],
        "squadSource": squad_state.squad_source,
        "suggestions": transfer_suggestions(squad_state, players_by_id, expected_points, weeks),
        "flags": collect_flags(squad_ids, players_by_id, histories, fixtures),
        "doubles": {
            str(week): sorted({
                teams_by_id[players_by_id[pid]["team"]]["short_name"]
                for pid in squad_ids
                if len(schedule[players_by_id[pid]["team"]].get(week, [])) > 1
            })
            for week in weeks
        },
        "priceWatch": price_watch,
        "chipPlan": build_chip_plan(bootstrap, fixtures, model_results, squad_state),
        "fixtureTicker": ticker,
        # Not sent with pages; the player panel loads one entry at a time.
        "playerDetails": build_player_details(
            bootstrap, histories, model_results, squad_state, ticker, price_watch, rules.POSITION_NAMES
        ),
        "chipsUsed": [{"name": chip["name"], "gameweek": chip["event"]} for chip in squad_state.chips_used],
    }
