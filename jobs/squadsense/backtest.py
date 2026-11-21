"""Backtest: how well would the xP model have predicted real points?

For every gameweek of a season, the model only sees matches played
before that week, predicts each starter's points, and we compare with
what he actually scored. Only players who started (60+ minutes, one
match that week) are scored, because the question is "how good is he
when he plays?". Whether he plays at all is a separate guess the
backtest can't check: old injury news isn't in the data.

Run from jobs/:

    python -m squadsense.backtest                 # current model, every season
    python -m squadsense.backtest --tune          # also search for better weights

What the numbers mean:

- top20: average real points of the model's 20 highest-xP starters each
  week. This is closest to how the app is used (picking players), so
  tuning tries to raise it.
- captain: average real points of the model's single top pick each week.
- slope: how much 1 point of predicted difference turned into real
  difference. 1.0 is ideal; below 1 means predictions are too spread out.
- mae: average gap between predicted and real points.
- bias: average predicted minus real, per position. Near 0 is good.
- buckets: the same bias split by what the player really scored (an
  idea from the OpenFPL paper): blank (2 or fewer), return (3-5), big
  (6-9) and haul (10+). A model can look fine on average while
  missing every haul, and hauls are what win weeks.

Options:

    --elo        start each club from Elo ratings instead of FPL's 1-5 rating
    --odds       blend in bookmaker odds for the coming week
    --horizon 3  also score predictions made 2 and 3 weeks ahead

Elo and odds need the football-data.co.uk files in .data/odds/ (the sync
downloads them; see the README).
"""

import argparse
import dataclasses
import json
import statistics
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

from . import fixtures as fixtures_module
from . import model
from .elo import club_ratings
from .fixtures import FixtureModel, fixtures_by_team_and_week, team_ratings
from .odds import market_goals, parse_matches, season_code
from .past_seasons import current_season, load_season
from .storage import FileStorage

FIRST_TEST_WEEK = 4  # earlier weeks have almost no history to learn from
TOP_PICKS = 20
POSITION_NAMES = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}


@dataclass
class WeekContext:
    """Everything known before one gameweek's matches."""

    week: int
    fixture_model: FixtureModel
    past_histories: dict


@dataclass
class Prediction:
    week: int
    position: int
    predicted: float
    actual: int


def season_odds(season, odds_folder):
    """The season's football-data.co.uk rows, or [] if the file wasn't downloaded."""
    start = int(season.name[:4])
    path = Path(odds_folder) / f"E0_{season_code(start)}.csv"
    return parse_matches(path.read_text(encoding="utf-8-sig")) if path.exists() else []


def all_results(odds_folder):
    """Every downloaded season's results, for the Elo ratings."""
    rows = []
    for path in sorted(Path(odds_folder).glob("E0_*.csv")):
        rows.extend(parse_matches(path.read_text(encoding="utf-8-sig")))
    return rows


def first_kickoff(season, week):
    """The date of a gameweek's first match (ISO), or None if unknown."""
    times = [fixture["kickoff_time"] for fixture in season.fixtures if fixture["event"] == week and fixture.get("kickoff_time")]
    return min(times)[:10] if times else None


def week_contexts(season, odds_folder=None, use_elo=False, use_market=False):
    """One WeekContext per testable gameweek, built only from what was known before it.

    With `use_elo`, each club's starting guess comes from Elo ratings as
    of the week's first kick-off. With `use_market`, matches with
    bookmaker odds blend in the odds' expected goals (used only for
    predictions of that same week, since odds for later weeks aren't
    published yet).
    """
    results = all_results(odds_folder) if odds_folder and use_elo else []
    odds_rows = season_odds(season, odds_folder) if odds_folder and use_market else []
    weeks = sorted({row["round"] for rows in season.histories.values() for row in rows})
    contexts = []
    for week in weeks:
        if week < FIRST_TEST_WEEK:
            continue
        past_histories = {player_id: [row for row in rows if row["round"] < week] for player_id, rows in season.histories.items()}
        past_fixtures = [dict(fixture, finished=fixture["finished"] and (fixture["event"] or 99) < week) for fixture in season.fixtures]
        kickoff = first_kickoff(season, week)
        elo = club_ratings(results, season.teams, kickoff) if results and kickoff else None
        market = market_goals(odds_rows, season.teams, season.fixtures, week, week) if odds_rows else {}
        fixture_model = FixtureModel(team_ratings(season.teams, past_fixtures, past_histories, elo), market)
        contexts.append(WeekContext(week, fixture_model, past_histories))
    return contexts


def starter_predictions(season, context, target_week=None):
    """Predicted and real points for every player who started once in `target_week`.

    The prediction only uses what `context` knew, so a context from an
    earlier week gives a prediction made further ahead. Odds only exist
    for the coming week, so they're dropped for predictions further out.
    """
    target_week = target_week or context.week
    fixture_model = context.fixture_model if target_week == context.week else FixtureModel(context.fixture_model.ratings)
    schedule = fixtures_by_team_and_week(season.fixtures, target_week, target_week)
    predictions = []
    for player_id, rows in season.histories.items():
        this_week = [row for row in rows if row["round"] == target_week]
        earlier = context.past_histories.get(player_id, [])
        if len(this_week) != 1 or this_week[0]["minutes"] < 60 or not earlier:
            continue
        row = this_week[0]
        player = dict(season.players[player_id], team=row["team"], chance_of_playing_next_round=None)
        # Score him as a starter: the question is how many points he gets when he plays.
        rates = dataclasses.replace(model.player_rates(player, earlier, season.pasts.get(player_id)), chance_60_minutes=1.0, chance_under_60=0.0)
        matches = schedule[row["team"]].get(target_week, [])
        predicted = model.expected_points_for_week(player, rates, matches, fixture_model)
        predictions.append(Prediction(target_week, player["element_type"], predicted, row["total_points"]))
    return predictions


def slope(predictions):
    """How much one point of predicted difference turned into real difference."""
    predicted = [item.predicted for item in predictions]
    actual = [item.actual for item in predictions]
    mean_predicted, mean_actual = statistics.mean(predicted), statistics.mean(actual)
    spread = sum((value - mean_predicted) ** 2 for value in predicted)
    return sum((p - mean_predicted) * (a - mean_actual) for p, a in zip(predicted, actual)) / spread


def score(predictions_by_week):
    """The summary numbers for a list of weeks' predictions."""
    everything = [item for week in predictions_by_week for item in week]
    top_picks = [sorted(week, key=lambda item: item.predicted, reverse=True)[:TOP_PICKS] for week in predictions_by_week]
    return {
        "top20": round(statistics.mean(statistics.mean(item.actual for item in picks) for picks in top_picks), 3),
        "captain": round(statistics.mean(picks[0].actual for picks in top_picks), 2),
        "slope": round(slope(everything), 2),
        "mae": round(statistics.mean(abs(item.predicted - item.actual) for item in everything), 2),
        "bias": {
            name: round(statistics.mean(item.predicted - item.actual for item in everything if item.position == position), 2)
            for position, name in POSITION_NAMES.items()
        },
        "starts": len(everything),
        "buckets": {
            name: round(statistics.mean(item.predicted - item.actual for item in members), 2) if members else None
            for name, members in bucket_members(everything).items()
        },
    }


# Real-points groups for the bucket scores: (name, lowest, highest).
BUCKETS = (("blank", -99, 2), ("return", 3, 5), ("big", 6, 9), ("haul", 10, 99))


def bucket_members(predictions):
    """Predictions grouped by the real points scored."""
    return {name: [item for item in predictions if low <= item.actual <= high] for name, low, high in BUCKETS}


def evaluate(seasons_with_contexts, weeks_ahead=1):
    """Scores the current model settings on each season and on all of them together.

    `weeks_ahead` 1 predicts each week just before it; 2 predicts it a
    week earlier, using only what was known then, and so on.
    """
    results, all_weeks = {}, []
    for season, contexts in seasons_with_contexts:
        known = {context.week for context in contexts}
        weeks = [
            starter_predictions(season, context, context.week + weeks_ahead - 1)
            for context in contexts
            if context.week + weeks_ahead - 1 in known
        ]
        weeks = [week for week in weeks if week]
        results[season.name] = score(weeks)
        all_weeks.extend(weeks)
    results["all"] = score(all_weeks)
    return results


@contextmanager
def model_settings(**settings):
    """Temporarily changes model weights, then puts the originals back.

    Settings are model.py's module-level names, e.g. PRIOR_MINUTES=180.
    Bonus priors go in as bonus_GK, bonus_DEF, bonus_MID or bonus_FWD.
    """
    saved = {name: getattr(model, name) for name in ("PRIOR_MINUTES", "HALF_LIFE_MATCHES", "RECENT_POINTS_WEIGHT", "ASSIST_FACTOR", "PAST_MINUTES_CAP")}
    # MARKET_WEIGHT is read when predicting, so it can change without rebuilding contexts.
    saved_market_weight = fixtures_module.MARKET_WEIGHT
    saved_priors = deepcopy(model.POSITION_PRIORS)
    try:
        for name, value in settings.items():
            if name.startswith("bonus_"):
                position = {short: position for position, short in POSITION_NAMES.items()}[name[len("bonus_"):]]
                model.POSITION_PRIORS[position]["bonus"] = value
            elif name in saved:
                setattr(model, name, value)
            elif name == "MARKET_WEIGHT":
                fixtures_module.MARKET_WEIGHT = value
            else:
                raise ValueError(f"Unknown model setting: {name}")
        yield
    finally:
        for name, value in saved.items():
            setattr(model, name, value)
        model.POSITION_PRIORS.clear()
        model.POSITION_PRIORS.update(saved_priors)
        fixtures_module.MARKET_WEIGHT = saved_market_weight


# The settings tuning tries, one at a time, with candidate values.
TUNING_GRID = {
    "PRIOR_MINUTES": [90, 180, 270, 450, 720],
    "HALF_LIFE_MATCHES": [3, 6, 10, 20],
    "RECENT_POINTS_WEIGHT": [0.0, 0.15, 0.3],
    "ASSIST_FACTOR": [1.0, 1.2, 1.4],
    "bonus_GK": [0.15, 0.25, 0.35],
    "bonus_DEF": [0.15, 0.25, 0.35],
    "bonus_MID": [0.2, 0.3, 0.4],
    "bonus_FWD": [0.4, 0.55, 0.7],
}


def tune(seasons_with_contexts, grid=TUNING_GRID, rounds=2):
    """Coordinate search: improve one setting at a time, keeping each win.

    Judged on top20 across all tuning seasons. Two rounds, because a
    change to one setting can shift the best value of another. Returns
    the chosen settings and a log of every value tried.
    """
    chosen, log = {}, []
    with model_settings():
        best = evaluate(seasons_with_contexts)["all"]["top20"]
    for _ in range(rounds):
        for name, candidates in grid.items():
            for value in candidates:
                trial = dict(chosen, **{name: value})
                with model_settings(**trial):
                    result = evaluate(seasons_with_contexts)["all"]
                log.append({"setting": name, "value": value, **result})
                if result["top20"] > best:
                    best, chosen = result["top20"], trial
    return chosen, log


def load_seasons(past_folder, live_folder, include_current):
    """Past seasons from the download folder, plus this season from the live cache if asked."""
    seasons = [load_season(folder) for folder in sorted(Path(past_folder).iterdir()) if folder.is_dir()]
    if include_current:
        live = Path(live_folder)
        bootstrap = json.loads((live / "raw_bootstrap-static.json").read_text())
        fixtures = json.loads((live / "raw_fixtures.json").read_text())
        storage = FileStorage(live)
        seasons.append(current_season(bootstrap, fixtures, storage.load_player_histories(), storage.load_player_pasts()))
    return seasons


def format_results(title, results):
    """A small plain-text table, one line per season."""
    bucket_names = " ".join(name for name, _, _ in BUCKETS)
    lines = [title, f'{"season":8} {"top20":>6} {"captain":>7} {"slope":>5} {"mae":>5}  bias (GK DEF MID FWD)   starts  bias by real points ({bucket_names})']
    for name, result in results.items():
        bias = " ".join(f'{result["bias"][position]:+.2f}' for position in POSITION_NAMES.values())
        buckets = " ".join("  n/a" if value is None else f"{value:+.2f}" for value in result["buckets"].values())
        lines.append(f'{name:8} {result["top20"]:6.2f} {result["captain"]:7.2f} {result["slope"]:5.2f} {result["mae"]:5.2f}  {bias}  {result["starts"]:6}  {buckets}')
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Backtest the xP model against real points.")
    parser.add_argument("--past-folder", default=".data/past", help="Folder with one subfolder per downloaded season")
    parser.add_argument("--live-folder", default=".data", help="The sync job's local data folder")
    parser.add_argument("--odds-folder", default=".data/odds", help="Folder with football-data.co.uk E0_<season>.csv files")
    parser.add_argument("--tune", action="store_true", help="Search for better weights on the past seasons")
    parser.add_argument("--elo", action="store_true", help="Start clubs from Elo ratings")
    parser.add_argument("--odds", action="store_true", help="Blend in bookmaker odds for the coming week")
    parser.add_argument("--horizon", type=int, default=1, help="Also score predictions made up to this many weeks ahead")
    args = parser.parse_args()

    options = {"odds_folder": args.odds_folder, "use_elo": args.elo, "use_market": args.odds}
    past = [(season, week_contexts(season, **options)) for season in load_seasons(args.past_folder, args.live_folder, False)]
    current = [(season, week_contexts(season, **options)) for season in load_seasons(args.past_folder, args.live_folder, True)[-1:]]
    for weeks_ahead in range(1, args.horizon + 1):
        ahead = "" if weeks_ahead == 1 else f", predicted {weeks_ahead} weeks ahead"
        print(format_results(f"Current model, past seasons{ahead}", evaluate(past, weeks_ahead)))
        print(format_results(f"Current model, this season{ahead}", evaluate(current, weeks_ahead)))
    if args.tune:
        chosen, _ = tune(past)
        print(f"\nBest settings on past seasons: {chosen}")
        with model_settings(**chosen):
            print(format_results("Tuned, past seasons", evaluate(past)))
            print(format_results("Tuned, this season (not used for tuning)", evaluate(current)))


if __name__ == "__main__":
    main()
