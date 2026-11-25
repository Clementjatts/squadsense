"""Backtest: does the Chip Planner pick better weeks than simple rules?

For each half of each downloaded past season, the model picks a squad
at the start of the half and keeps it (nobody's real squads are
available, so this is a stand-in). Then each way of choosing a week
plays Triple Captain and Bench Boost once, and we add up the real
points the chip earned:

- planner: what the Chip Planner does. Each week it forecasts the rest
  of the half from matches played so far and plays the chip if this
  week is worth at least PLAY_SHARE of the best week left (the last
  week if it never is).
- best week only: the same, but only playing in the single best
  forecast week. This was the first version, and it waited too long.
- first double: the first week the captain (Triple Captain) or any
  squad player (Bench Boost) plays twice; the first week if none do.
- double xW: the planner, with the first known double gameweek after
  the five-week plan counted W times, the way strategy.DOUBLE_WEIGHT
  does it in the live keep values. One column per --double-weights value.
- straight away: the first week of the half.
- average week: the real gain averaged over every week of the half,
  which is what picking a week at random would earn.
- hindsight: the best real week, which no method can beat.

Run from jobs/:

    python -m squadsense.chip_backtest
"""

import argparse
import statistics
from pathlib import Path

from . import model
from .backtest import FIRST_TEST_WEEK, week_contexts
from .chips import PLAY_SHARE
from .fixtures import fixtures_by_team_and_week
from .past_seasons import load_season
from .planner import best_lineup
from .squad_builder import pick_best_squad

HALVES = ((FIRST_TEST_WEEK, 19), (20, 38))
# Past fixture files already hold every double gameweek, but in real life a
# double is only announced some weeks ahead, once a cup tie or a postponed
# match is rescheduled. So the backtests only count a double as known from
# this many weeks before it. Six is a rough guess at typical notice.
DOUBLE_NOTICE_WEEKS = 6
PLAN_WEEKS = 5  # the live strategy plans five weeks; only doubles after them change keep values
SQUAD_WINDOW = 5  # weeks the starting squad is picked for
METHODS = ("planner", "best week only", "first double", "straight away", "average week", "hindsight")


class SeasonForecaster:
    """Forecasts any later week's xP using only matches played before a given week."""

    def __init__(self, season):
        self.season = season
        self.contexts = {context.week: context for context in week_contexts(season)}
        self.schedules = {}

    def schedule(self, week):
        if week not in self.schedules:
            self.schedules[week] = fixtures_by_team_and_week(self.season.fixtures, week, week)
        return self.schedules[week]

    def player_at(self, player_id, decision_week):
        """The player as the model saw him before `decision_week`: position, club and price."""
        earlier = self.contexts[decision_week].past_histories.get(player_id, [])
        rows = earlier or self.season.histories[player_id]
        latest = rows[-1] if earlier else rows[0]
        return dict(self.season.players[player_id], team=latest["team"], now_cost=latest["value"], chance_of_playing_next_round=None)

    def forecast(self, player_ids, decision_week, weeks):
        """{player_id: {week: xP}} for `weeks`, as predicted before `decision_week`."""
        context = self.contexts[decision_week]
        result = {}
        for player_id in player_ids:
            player = self.player_at(player_id, decision_week)
            rates = model.player_rates(player, context.past_histories.get(player_id, []))
            result[player_id] = {
                week: model.expected_points_for_week(player, rates, self.schedule(week)[player["team"]].get(week, []), context.fixture_model)
                for week in weeks
            }
        return result

    def matches(self, player_id, decision_week, week):
        return self.schedule(week)[self.player_at(player_id, decision_week)["team"]].get(week, [])

    def real_points(self, player_id, week):
        return sum(row["total_points"] for row in self.season.histories.get(player_id, []) if row["round"] == week)


def starting_squad(forecaster, first_week):
    """The model's best 15 for the first SQUAD_WINDOW weeks of a half, within £100m."""
    candidates = [player_id for player_id, rows in forecaster.contexts[first_week].past_histories.items() if rows]
    weeks = list(range(first_week, first_week + SQUAD_WINDOW))
    forecast = forecaster.forecast(candidates, first_week, weeks)
    players = [forecaster.player_at(player_id, first_week) for player_id in candidates]
    combined = {player_id: {"window": sum(by_week.values())} for player_id, by_week in forecast.items()}
    return pick_best_squad(players, combined, "window")


def chip_gain(chip, lineup, forecaster, week):
    """Real points a chip adds in `week`: the captain's once more, or the bench's."""
    if chip == "3xc":
        return forecaster.real_points(lineup["captain"], week)
    return sum(forecaster.real_points(player_id, week) for player_id in lineup["bench"])


def known_double(chip, squad, lineup, forecaster, decision_week, week):
    """True when `week` is a double for this chip and is already known at `decision_week`.

    Triple Captain needs that week's captain to play twice, Bench Boost anyone in the squad.
    """
    if week - decision_week > DOUBLE_NOTICE_WEEKS:
        return False
    players = [lineup["captain"]] if chip == "3xc" else squad
    return any(len(forecaster.matches(player_id, decision_week, week)) > 1 for player_id in players)


def planner_week(chip, squad, players_by_id, forecaster, weeks, play_share=PLAY_SHARE, double_weight=1.0):
    """The first week worth at least `play_share` of the best one left, by the forecast made that week.

    1.0 means "only if this week is the best"; lower values play sooner.
    `double_weight` counts the first known double after the five-week plan
    that many times, as strategy.keep_values does with DOUBLE_WEIGHT.
    """
    for index, week in enumerate(weeks):
        remaining = weeks[index:]
        forecast = forecaster.forecast(squad, week, remaining)
        values, weighted = {}, False
        for later in remaining:
            lineup = best_lineup(squad, players_by_id, forecast, later)
            values[later] = forecast[lineup["captain"]][later] if chip == "3xc" else sum(forecast[p][later] for p in lineup["bench"])
            if not weighted and later >= week + PLAN_WEEKS and known_double(chip, squad, lineup, forecaster, week, later):
                values[later] *= double_weight
                weighted = True
        if values[week] >= play_share * max(values.values()):
            return week
    return weeks[-1]


def first_double_week(chip, squad, lineups, forecaster, weeks):
    """The first week the captain (or, for Bench Boost, anyone in the squad) plays twice."""
    for week in weeks:
        players = [lineups[week]["captain"]] if chip == "3xc" else squad
        if any(len(forecaster.matches(player_id, week, week)) > 1 for player_id in players):
            return week
    return weeks[0]


def backtest_half(forecaster, start, stop, double_weights=()):
    """{chip: {method: real gain}} for one half of one season, with a "double xW" method per weight."""
    weeks = [week for week in range(start, stop + 1) if week in forecaster.contexts]
    squad = starting_squad(forecaster, weeks[0])
    players_by_id = {player_id: forecaster.player_at(player_id, weeks[0]) for player_id in squad}
    # Each week's lineup uses that week's forecast, the way you'd pick it at the deadline.
    lineups = {week: best_lineup(squad, players_by_id, forecaster.forecast(squad, week, [week]), week) for week in weeks}
    real = {chip: {week: chip_gain(chip, lineups[week], forecaster, week) for week in weeks} for chip in ("3xc", "bboost")}

    results = {}
    for chip, gains in real.items():
        results[chip] = {
            "planner": gains[planner_week(chip, squad, players_by_id, forecaster, weeks)],
            "best week only": gains[planner_week(chip, squad, players_by_id, forecaster, weeks, play_share=1.0)],
            "first double": gains[first_double_week(chip, squad, lineups, forecaster, weeks)],
            "straight away": gains[weeks[0]],
            "average week": statistics.mean(gains.values()),
            "hindsight": max(gains.values()),
        }
        for weight in double_weights:
            results[chip][f"double x{weight}"] = gains[planner_week(chip, squad, players_by_id, forecaster, weeks, double_weight=weight)]
    return results


def format_results(all_results, methods=METHODS):
    """A plain-text table: average real points per chip and method, one line per half."""
    lines = []
    for chip, label in (("3xc", "Triple Captain"), ("bboost", "Bench Boost")):
        lines.append(f"\n{label}: real points the chip added")
        lines.append(f'{"half":14}' + "".join(f"{method:>15}" for method in methods))
        for name, results in all_results.items():
            lines.append(f"{name:14}" + "".join(f"{results[chip][method]:15.1f}" for method in methods))
        averages = [statistics.mean(results[chip][method] for results in all_results.values()) for method in methods]
        lines.append(f'{"average":14}' + "".join(f"{value:15.1f}" for value in averages))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Backtest the Chip Planner's timing against simple rules.")
    parser.add_argument("--past-folder", default=".data/past", help="Folder with one subfolder per downloaded season")
    parser.add_argument("--double-weights", default="", help="Comma-separated DOUBLE_WEIGHT values to try, e.g. 1.0,1.2,1.4")
    args = parser.parse_args()
    double_weights = [float(weight) for weight in args.double_weights.split(",") if weight]

    all_results = {}
    for folder in sorted(Path(args.past_folder).iterdir()):
        if not folder.is_dir():
            continue
        forecaster = SeasonForecaster(load_season(folder))
        for start, stop in HALVES:
            all_results[f"{folder.name} {start}-{stop}"] = backtest_half(forecaster, start, stop, double_weights)
            print(f"Done {folder.name} GW{start}-{stop}", flush=True)
    print(format_results(all_results, METHODS + tuple(f"double x{weight}" for weight in double_weights)))


if __name__ == "__main__":
    main()
