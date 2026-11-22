"""Checks FPL's price change predictor against the price changes that happened.

Every sync saves that day's predictions (price_watch.predictions_record):
each player's price and FPL's likelihood, from -5 to 5, that he changes at
the next 00:00 UK. The last run before midnight is the one kept. This
script compares each day's predictions with the prices saved the day
after, and reports for each likelihood band how often the price really
moved that way.

Price Watch, the "TONIGHT" tags and the plan's price notes all trust
bands of 3 or more, so the numbers for those bands are the ones to watch.

Run from jobs/:  python -m squadsense.price_audit
(It reads Supabase when DATABASE_URL is set, otherwise the local .data folder.)
"""

import argparse
import datetime
from collections import defaultdict

from .sync import choose_storage

PREFIX = "price_predictions/"


def next_day(day):
    """The ISO date after `day`."""
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat()


def outcomes(records):
    """(likelihood, direction moved) for every player on every day that has a next day.

    The direction is 1 for a rise, -1 for a fall and 0 for no change. Days
    without a record for the following day are skipped, since the change
    can't be seen.
    """
    by_day = {record["day"]: record["players"] for record in records}
    pairs = []
    for day, players in sorted(by_day.items()):
        following = by_day.get(next_day(day))
        if following is None:
            continue
        for player_id, (price, likelihood) in players.items():
            if player_id in following:
                moved = following[player_id][0] - price
                pairs.append((likelihood, (moved > 0) - (moved < 0)))
    return pairs


def band_table(pairs):
    """{likelihood: {"players", "rose", "fell", "unchanged"}} from the pairs."""
    table = defaultdict(lambda: {"players": 0, "rose": 0, "fell": 0, "unchanged": 0})
    for likelihood, direction in pairs:
        row = table[likelihood]
        row["players"] += 1
        row["rose" if direction > 0 else "fell" if direction < 0 else "unchanged"] += 1
    return dict(table)


def report(records):
    """The audit as text: one line per likelihood band, rises first."""
    pairs = outcomes(records)
    nights = len({record["day"] for record in records if next_day(record["day"]) in {other["day"] for other in records}})
    if not pairs:
        return f"Not enough data yet: {len(records)} day(s) of predictions saved, and two days in a row are needed."
    lines = [f"{nights} night(s) checked, {len(pairs)} player-nights", f"{'band':>5} {'players':>8} {'rose':>6} {'fell':>6} {'same':>6}  right"]
    for likelihood, row in sorted(band_table(pairs).items(), reverse=True):
        right = row["rose"] if likelihood > 0 else row["fell"] if likelihood < 0 else row["unchanged"]
        lines.append(f"{likelihood:>5} {row['players']:8} {row['rose']:6} {row['fell']:6} {row['unchanged']:6}  {right / row['players']:.0%}")
    missed = sum(1 for likelihood, direction in pairs if likelihood == 0 and direction != 0)
    lines.append(f"Changes FPL rated 0 (no change): {missed}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Check FPL's price predictor against real price changes.")
    parser.add_argument("--local-folder", default=".data", help="The sync job's local data folder, used when DATABASE_URL isn't set")
    args = parser.parse_args()
    print(report(choose_storage(args.local_folder).load_raws(PREFIX)))


if __name__ == "__main__":
    main()
