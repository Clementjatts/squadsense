"""Loads past FPL seasons for backtesting, in the same shapes as the live API.

The data comes from the community dataset at
https://github.com/vaastav/Fantasy-Premier-League (please credit it if
you share results). Each season folder needs three CSV files:
merged_gw.csv (one row per player per match), fixtures.csv and
teams.csv. The README's backtest section has the download commands.
They're read as plain text; nothing in them is run.

Turning them into API-shaped records means the backtest runs the real
model code with no special cases. Two differences from the live API are
smoothed over here:

- Older seasons keep the 1-5 team rating in a column called `strength`
  and use a 1000-1400 scale for `strength_overall_*`. We copy the 1-5
  rating into `strength_overall_*` so the model sees the 2026/27 shape.
- 2024-25 had an "assistant manager" chip with its own rows (position
  "AM"). Those aren't players, so they're skipped.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

POSITION_IDS = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}


@dataclass
class Season:
    """One season's data in live-API shapes, ready for the backtest."""

    name: str
    teams: list  # like bootstrap-static `teams`
    fixtures: list  # like the fixtures endpoint
    players: dict  # {player_id: {"id", "web_name", "element_type"}}
    histories: dict  # {player_id: [history rows, oldest first]}; rows also carry "team"
    pasts: dict = field(default_factory=dict)  # {player_id: history_past rows}; empty for downloaded seasons


def read_csv(path):
    """All rows of a CSV file as dicts. Raises a clear error if the file is missing."""
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing. Download the season first (see the README's backtest section).")
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def as_bool(text):
    return str(text).strip().lower() == "true"


def as_int_or_none(text):
    return int(float(text)) if str(text).strip() not in ("", "None", "nan") else None


def convert_teams(rows):
    """teams.csv rows to API-style teams, with the 1-5 rating where the model expects it."""
    return [
        {
            "id": int(row["id"]), "name": row["name"], "short_name": row["short_name"],
            "strength_overall_home": int(row["strength"]), "strength_overall_away": int(row["strength"]),
        }
        for row in rows
    ]


def convert_fixtures(rows):
    """fixtures.csv rows to API-style fixtures. Postponed matches have no gameweek."""
    return [
        {
            "id": int(row["id"]), "event": as_int_or_none(row["event"]), "finished": as_bool(row["finished"]),
            "team_h": int(row["team_h"]), "team_a": int(row["team_a"]),
            "team_h_difficulty": as_int_or_none(row["team_h_difficulty"]),
            "team_a_difficulty": as_int_or_none(row["team_a_difficulty"]),
        }
        for row in rows
    ]


def history_row(row, fixtures_by_id):
    """One merged_gw.csv row as an element-summary history row, plus the player's club.

    The club comes from the fixture, because a player who moved in
    January appears for two clubs in one season.
    """
    fixture = fixtures_by_id[int(row["fixture"])]
    is_home = as_bool(row["was_home"])
    return {
        "round": int(row["round"]), "fixture": fixture["id"], "was_home": is_home,
        "team": fixture["team_h"] if is_home else fixture["team_a"],
        "minutes": int(row["minutes"]), "total_points": int(row["total_points"]),
        "expected_goals": row["expected_goals"], "expected_assists": row["expected_assists"],
        "goals_scored": int(row["goals_scored"]), "assists": int(row["assists"]),
        "bonus": int(row["bonus"]), "saves": int(row["saves"]), "value": int(row["value"]),
        # Defensive contribution points started in 2025/26, so older rows have none.
        "defensive_contribution": int(row.get("defensive_contribution") or 0),
    }


def load_season(folder):
    """Reads one downloaded season folder into a Season."""
    folder = Path(folder)
    fixtures = convert_fixtures(read_csv(folder / "fixtures.csv"))
    fixtures_by_id = {fixture["id"]: fixture for fixture in fixtures}

    players, histories = {}, {}
    for row in read_csv(folder / "merged_gw.csv"):
        if row["position"] not in POSITION_IDS:
            continue  # assistant manager rows
        player_id = int(row["element"])
        players.setdefault(player_id, {"id": player_id, "web_name": row["name"], "element_type": POSITION_IDS[row["position"]]})
        histories.setdefault(player_id, []).append(history_row(row, fixtures_by_id))
    for rows in histories.values():
        rows.sort(key=lambda history: (history["round"], history["fixture"]))

    return Season(folder.name, convert_teams(read_csv(folder / "teams.csv")), fixtures, players, histories)


def current_season(bootstrap, fixtures, histories, pasts=None):
    """This season's cached live data as a Season, for the final check.

    History rows from the live API don't name the club, so it's added
    from each row's fixture, the same way load_season does.
    """
    fixtures_by_id = {fixture["id"]: fixture for fixture in fixtures}
    players = {player["id"]: {"id": player["id"], "web_name": player["web_name"], "element_type": player["element_type"]}
               for player in bootstrap["elements"]}
    with_teams = {}
    for player_id, rows in histories.items():
        with_teams[player_id] = [
            dict(row, team=fixtures_by_id[row["fixture"]]["team_h" if row["was_home"] else "team_a"])
            for row in rows if row["fixture"] in fixtures_by_id
        ]
    return Season("2026-27", bootstrap["teams"], fixtures, players, with_teams, pasts or {})
