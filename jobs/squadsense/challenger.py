"""A challenger points model, to test ours against (backtest only).

The idea comes from OpenFPL (github.com/daniegr/OpenFPL): instead of
building points up from per-90 rates like model.py does, learn points
directly from a player's recent averages with gradient-boosted trees.
Features are his averages over his last 1, 3, 5, 10 and 38 appearances
(points, minutes, xG, xA, bonus, saves, defensive contributions), his
position, and the expected goals for and against from our fixture model.

It's judged with the same numbers as the main backtest. Each past
season is predicted by a model trained on the other past seasons, and
this season by a model trained on all past seasons, so a model never
sees the matches it's tested on. It only joins the app if it wins.

Run from jobs/ (needs scikit-learn from requirements-dev.txt):

    python -m squadsense.challenger
"""

import argparse

import numpy
from sklearn.ensemble import HistGradientBoostingRegressor

from .backtest import Prediction, format_results, load_seasons, score, week_contexts
from .fixtures import fixtures_by_team_and_week
from .model import _as_float

WINDOWS = (1, 3, 5, 10, 38)
STATS = ("total_points", "minutes", "expected_goals", "expected_assists", "bonus", "saves", "defensive_contribution")


def window_averages(appearances):
    """Each stat's average over the last 1, 3, 5, 10 and 38 appearances (zeros if too few)."""
    features = []
    for window in WINDOWS:
        recent = appearances[-window:]
        for stat in STATS:
            features.append(sum(_as_float(row.get(stat)) for row in recent) / len(recent) if recent else 0.0)
    return features


def season_samples(season, contexts):
    """(features, real points, Prediction stub) for every starter in every testable week."""
    samples = []
    for context in contexts:
        schedule = fixtures_by_team_and_week(season.fixtures, context.week, context.week)
        for player_id, rows in season.histories.items():
            this_week = [row for row in rows if row["round"] == context.week]
            earlier = [row for row in context.past_histories.get(player_id, []) if row["minutes"] > 0]
            if len(this_week) != 1 or this_week[0]["minutes"] < 60 or not earlier:
                continue
            row = this_week[0]
            matches = schedule[row["team"]].get(context.week, [])
            goals_for = sum(context.fixture_model.expected_goals(row["team"], match["opponent"], match["is_home"]) for match in matches)
            goals_against = sum(context.fixture_model.expected_goals(match["opponent"], row["team"], not match["is_home"]) for match in matches)
            position = season.players[player_id]["element_type"]
            features = [*(position == kind for kind in (1, 2, 3, 4)), len(matches), goals_for, goals_against, *window_averages(earlier)]
            samples.append((features, row["total_points"], Prediction(context.week, position, 0.0, row["total_points"])))
    return samples


def train(samples):
    """A gradient-boosted model fitted to the samples' real points."""
    regressor = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40, random_state=0)
    regressor.fit(numpy.array([features for features, _, _ in samples], dtype=float), numpy.array([points for _, points, _ in samples]))
    return regressor


def predicted_weeks(regressor, samples):
    """The samples as lists of Predictions per week, with the model's numbers filled in."""
    predicted = regressor.predict(numpy.array([features for features, _, _ in samples], dtype=float))
    weeks = {}
    for (_, _, stub), value in zip(samples, predicted):
        weeks.setdefault(stub.week, []).append(Prediction(stub.week, stub.position, float(value), stub.actual))
    return list(weeks.values())


def main():
    parser = argparse.ArgumentParser(description="Backtest the challenger points model.")
    parser.add_argument("--past-folder", default=".data/past")
    parser.add_argument("--live-folder", default=".data")
    args = parser.parse_args()

    seasons = load_seasons(args.past_folder, args.live_folder, True)
    samples = {season.name: season_samples(season, week_contexts(season)) for season in seasons}
    past_names, current_name = [season.name for season in seasons[:-1]], seasons[-1].name

    results = {}
    for name in past_names:
        training = [sample for other in past_names if other != name for sample in samples[other]]
        results[name] = score(predicted_weeks(train(training), samples[name]))
    results[current_name] = score(predicted_weeks(train([s for name in past_names for s in samples[name]]), samples[current_name]))
    print(format_results("Challenger (gradient boosting), each season predicted by a model trained on other seasons", results))


if __name__ == "__main__":
    main()
