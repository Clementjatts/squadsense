"""Checks captaincy.py's haul and blank chances against what really happened.

The Dashboard says things like "23% chance of 10+ points". This script
tests whether those percentages are honest. For each week of the
downloaded seasons it takes the model's top captain options (using only
what was known before that week, exactly like backtest.py), works out
their raw haul and blank chances with captaincy.simulated_chances, and then
looks at their real points.

Two measures come out:

- Brier score: the average squared gap between the chance and what
  happened (1 or 0). Lower is better. It's printed next to the score of
  always guessing the overall rate, so you can see if the model beats
  that simple guess.
- A calibration table: chances grouped into bands (0-10%, 10-20%, ...).
  In a well-calibrated band, the share that really hauled matches the
  average chance given.

It then fits the correction captaincy.py applies (Platt scaling: two
numbers per measure) and checks it fairly: for each season, the numbers
are fitted on the other seasons and scored on the one left out. The fit
on every season is printed last, to copy into captaincy.py.

The simulation takes a while, so the calls are saved to
.data/captain_calls.json; --reuse scores those again without simulating.

Run from jobs/:  python -m squadsense.captain_calibration [--reuse]
"""

import argparse
import json
import math
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path

from . import model
from .backtest import load_seasons, week_contexts
from .captaincy import BLANK_POINTS, CLAMP, HAUL_POINTS, calibrate, simulated_chances
from .fixtures import fixtures_by_team_and_week

CANDIDATES_PER_WEEK = 5  # like the Dashboard's captain list
BANDS = 10  # 0-10%, 10-20%, ... 90-100%
NEWTON_STEPS = 50
CALLS_FILE = "captain_calls.json"


@dataclass
class CaptainCall:
    """One captain option in one week: the simulation's raw chances and the real points."""

    season: str
    week: int
    haul_chance: float
    blank_chance: float
    points: int

    @property
    def hauled(self):
        return self.points >= HAUL_POINTS

    @property
    def blanked(self):
        return self.points <= BLANK_POINTS


def player_week_points(rows, week):
    """A player's real points in one gameweek, adding both matches of a double. 0 if he had no match."""
    return sum(row["total_points"] for row in rows if row["round"] == week)


def captain_calls(season, context, candidates, simulations):
    """The top `candidates` captain options for one week, scored against reality.

    Players are ranked by expected points from what was known before the
    week, the same way the sync ranks its captain options. Real points
    include weeks he didn't play (0), since a captain who misses out is a
    real outcome of the pick.
    """
    schedule = fixtures_by_team_and_week(season.fixtures, context.week, context.week)
    options = []
    for player_id, earlier in context.past_histories.items():
        if not earlier:
            continue
        team = earlier[-1]["team"]
        matches = schedule.get(team, {}).get(context.week, [])
        if not matches:
            continue
        player = dict(season.players[player_id], team=team, chance_of_playing_next_round=None)
        rates = model.player_rates(player, earlier, season.pasts.get(player_id))
        options.append((model.expected_points_for_week(player, rates, matches, context.fixture_model), player, rates, matches))
    options.sort(key=lambda option: option[0], reverse=True)
    calls = []
    for _, player, rates, matches in options[:candidates]:
        chances = simulated_chances(player, rates, matches, context.fixture_model, simulations)
        points = player_week_points(season.histories[player["id"]], context.week)
        calls.append(CaptainCall(season.name, context.week, chances["haulChance"], chances["blankChance"], points))
    return calls


def brier(chances, outcomes):
    """Average squared gap between each chance and what happened (1 or 0). Lower is better."""
    return statistics.mean((chance - outcome) ** 2 for chance, outcome in zip(chances, outcomes))


def calibration_rows(chances, outcomes):
    """(band label, count, average chance given, share that happened) for each band with any calls."""
    rows = []
    for band in range(BANDS):
        low, high = band / BANDS, (band + 1) / BANDS
        members = [(chance, outcome) for chance, outcome in zip(chances, outcomes) if low <= chance < high or (band == BANDS - 1 and chance == 1.0)]
        if members:
            rows.append((f"{low:.0%}-{high:.0%}", len(members), statistics.mean(c for c, _ in members), statistics.mean(o for _, o in members)))
    return rows


def report(title, chances, outcomes):
    """The Brier score against the always-guess-the-average score, then the calibration table, as text."""
    base_rate = statistics.mean(outcomes)
    lines = [
        f"{title}: {len(outcomes)} calls, happened {base_rate:.1%} of the time",
        f"  Brier score {brier(chances, outcomes):.4f} (always guessing {base_rate:.1%} scores {brier([base_rate] * len(outcomes), outcomes):.4f})",
        f"  {'band':>9} {'calls':>6} {'chance given':>13} {'happened':>9}",
    ]
    for label, count, given, happened in calibration_rows(chances, outcomes):
        lines.append(f"  {label:>9} {count:6} {given:13.1%} {happened:9.1%}")
    return "\n".join(lines)


def logit(chance):
    """log(p / (1 - p)), with the chance clamped like captaincy.calibrate does."""
    clamped = min(max(chance, CLAMP), 1 - CLAMP)
    return math.log(clamped / (1 - clamped))


def fit_platt(chances, outcomes):
    """The (a, b) that make calibrate(chance, (a, b)) best match the outcomes.

    Logistic regression of the outcome on logit(chance), solved with
    Newton steps. Starts from (0, 1), which changes nothing.
    """
    xs = [logit(chance) for chance in chances]
    a, b = 0.0, 1.0
    for _ in range(NEWTON_STEPS):
        grad_a = grad_b = h_aa = h_ab = h_bb = 0.0
        for x, y in zip(xs, outcomes):
            p = 1 / (1 + math.exp(-(a + b * x)))
            weight = p * (1 - p)
            grad_a += y - p
            grad_b += (y - p) * x
            h_aa += weight
            h_ab += weight * x
            h_bb += weight * x * x
        determinant = h_aa * h_bb - h_ab * h_ab
        if determinant <= 0:
            raise ValueError("Can't fit the correction: the chances given are all the same")
        a += (h_bb * grad_a - h_ab * grad_b) / determinant
        b += (h_aa * grad_b - h_ab * grad_a) / determinant
    return a, b


def measure_of(calls, measure):
    """(raw chances, outcomes) for "haul" or "blank"."""
    if measure == "haul":
        return [call.haul_chance for call in calls], [int(call.hauled) for call in calls]
    return [call.blank_chance for call in calls], [int(call.blanked) for call in calls]


def cross_validate(calls, measure):
    """For each season: fit on the others, then Brier scores on it for the raw, corrected and flat chances.

    The flat guess is the other seasons' overall rate, so all three are
    judged on data they never saw.
    """
    rows = []
    for season in sorted({call.season for call in calls}):
        train_chances, train_outcomes = measure_of([call for call in calls if call.season != season], measure)
        test_chances, test_outcomes = measure_of([call for call in calls if call.season == season], measure)
        numbers = fit_platt(train_chances, train_outcomes)
        flat = statistics.mean(train_outcomes)
        rows.append({
            "season": season,
            "calls": len(test_outcomes),
            "raw": brier(test_chances, test_outcomes),
            "corrected": brier([calibrate(chance, numbers) for chance in test_chances], test_outcomes),
            "flat": brier([flat] * len(test_outcomes), test_outcomes),
        })
    return rows


def cross_validation_report(calls, measure):
    """The season-by-season scores and the fit on every season, as text."""
    lines = [f"{measure.title()} chance, fitted without each season (Brier, lower is better):",
             f"  {'season':>8} {'calls':>6} {'raw':>7} {'corrected':>10} {'flat':>7}"]
    for row in cross_validate(calls, measure):
        lines.append(f"  {row['season']:>8} {row['calls']:6} {row['raw']:7.4f} {row['corrected']:10.4f} {row['flat']:7.4f}")
    chances, outcomes = measure_of(calls, measure)
    a, b = fit_platt(chances, outcomes)
    lines.append(f"  Fit on every season: ({a:.3f}, {b:.3f})")
    corrected = [calibrate(chance, (a, b)) for chance in chances]
    lines.append(report("  Corrected on every season", corrected, outcomes))
    return "\n".join(lines)


def simulate_calls(args):
    """Every past captain call, simulated and scored, then saved for --reuse."""
    calls = []
    for season in load_seasons(args.past_folder, args.live_folder, True):
        for context in week_contexts(season):
            calls.extend(captain_calls(season, context, args.candidates, args.simulations))
        print(f"{season.name}: {len(calls)} calls so far")
    Path(args.live_folder, CALLS_FILE).write_text(json.dumps([asdict(call) for call in calls]))
    return calls


def main():
    parser = argparse.ArgumentParser(description="Check and fit the captain haul and blank chances against real points.")
    parser.add_argument("--past-folder", default=".data/past", help="Folder with one subfolder per downloaded season")
    parser.add_argument("--live-folder", default=".data", help="The sync job's local data folder")
    parser.add_argument("--candidates", type=int, default=CANDIDATES_PER_WEEK, help="Captain options scored per week")
    parser.add_argument("--simulations", type=int, default=2000, help="Simulated matches per option (the live site uses 4000)")
    parser.add_argument("--reuse", action="store_true", help=f"Score the calls saved in {CALLS_FILE} without simulating again")
    args = parser.parse_args()

    if args.reuse:
        calls = [CaptainCall(**row) for row in json.loads(Path(args.live_folder, CALLS_FILE).read_text())]
    else:
        calls = simulate_calls(args)
    print(report(f"Haul ({HAUL_POINTS}+ points), raw", *measure_of(calls, "haul")))
    print(report(f"Blank ({BLANK_POINTS} or fewer), raw", *measure_of(calls, "blank")))
    print(cross_validation_report(calls, "haul"))
    print(cross_validation_report(calls, "blank"))


if __name__ == "__main__":
    main()
