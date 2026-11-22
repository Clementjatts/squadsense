"""Checks captaincy.py's haul and blank chances against what really happened.

The Dashboard says things like "23% chance of 10+ points". This script
tests whether those percentages are honest. For each week of the
downloaded seasons it takes the model's top captain options (using only
what was known before that week, exactly like backtest.py), works out
their haul and blank chances with captaincy.outcome_chances, and then
looks at their real points.

Two measures come out:

- Brier score: the average squared gap between the chance and what
  happened (1 or 0). Lower is better. It's printed next to the score of
  always guessing the overall rate, so you can see if the model beats
  that simple guess.
- A calibration table: chances grouped into bands (0-10%, 10-20%, ...).
  In a well-calibrated band, the share that really hauled matches the
  average chance given.

Run from jobs/:  python -m squadsense.captain_calibration
"""

import argparse
import statistics
from dataclasses import dataclass

from . import model
from .backtest import load_seasons, week_contexts
from .captaincy import BLANK_POINTS, HAUL_POINTS, outcome_chances
from .fixtures import fixtures_by_team_and_week

CANDIDATES_PER_WEEK = 5  # like the Dashboard's captain list
BANDS = 10  # 0-10%, 10-20%, ... 90-100%


@dataclass
class CaptainCall:
    """One captain option in one week: the chances given and the real points."""

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
        chances = outcome_chances(player, rates, matches, context.fixture_model, simulations)
        points = player_week_points(season.histories[player["id"]], context.week)
        calls.append(CaptainCall(context.week, chances["haulChance"], chances["blankChance"], points))
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


def main():
    parser = argparse.ArgumentParser(description="Check the captain haul and blank chances against real points.")
    parser.add_argument("--past-folder", default=".data/past", help="Folder with one subfolder per downloaded season")
    parser.add_argument("--live-folder", default=".data", help="The sync job's local data folder")
    parser.add_argument("--candidates", type=int, default=CANDIDATES_PER_WEEK, help="Captain options scored per week")
    parser.add_argument("--simulations", type=int, default=2000, help="Simulated matches per option (the live site uses 4000)")
    args = parser.parse_args()

    calls = []
    for season in load_seasons(args.past_folder, args.live_folder, True):
        for context in week_contexts(season):
            calls.extend(captain_calls(season, context, args.candidates, args.simulations))
        print(f"{season.name}: {len(calls)} calls so far")
    print(report(f"Haul ({HAUL_POINTS}+ points)", [call.haul_chance for call in calls], [int(call.hauled) for call in calls]))
    print(report(f"Blank ({BLANK_POINTS} or fewer)", [call.blank_chance for call in calls], [int(call.blanked) for call in calls]))


if __name__ == "__main__":
    main()
