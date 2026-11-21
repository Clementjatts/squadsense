"""Bookmaker odds and results from football-data.co.uk, a free source.

Two things come from here:

- Results of every Premier League match since 2019-20, which elo.py
  turns into team ratings.
- Pre-match odds. Bookmakers price in injuries, team news and form,
  so their odds are a strong second opinion on how many goals each team
  will score. We take the home win, draw, away win and over/under 2.5
  goals odds, remove the bookmaker's margin, and find the pair of
  expected goals (home, away) whose Poisson scorelines match those
  chances best.

football-data.co.uk publishes one CSV per season (mmz4281/<code>/E0.csv)
and one for the next round of fixtures (fixtures.csv), which switches to
the next round partway through the week. Past seasons never change, so
they're downloaded once; the current season and fixtures are refreshed
every REFRESH_HOURS.
"""

import csv
import io
import logging
from datetime import datetime, timedelta, timezone

import httpx
import numpy

log = logging.getLogger("squadsense.odds")

BASE_URL = "https://www.football-data.co.uk"
FIRST_SEASON = 2019  # 2019-20, enough seasons for the Elo ratings to settle
REFRESH_HOURS = 6
MAX_GOALS = 10

# football-data.co.uk spells some clubs differently from FPL.
FPL_TO_ODDS_NAMES = {
    "Spurs": "Tottenham",
    "Man Utd": "Man United",
    "Sheffield Utd": "Sheffield United",
    "Coventry City": "Coventry",
    "Hull City": "Hull",
    "Ipswich Town": "Ipswich",
    "Leicester City": "Leicester",
    "Luton Town": "Luton",
    "Norwich City": "Norwich",
    "Stoke City": "Stoke",
    "Cardiff City": "Cardiff",
    "Swansea City": "Swansea",
    "West Brom": "West Brom",
}


class OddsError(Exception):
    """Raised when football-data.co.uk can't be read."""


def odds_name(fpl_name):
    """The football-data.co.uk spelling of an FPL club name."""
    return FPL_TO_ODDS_NAMES.get(fpl_name, fpl_name)


def season_code(start_year):
    """2026 -> "2627", the season code in football-data.co.uk's URLs."""
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def _number(text):
    """A float from a CSV cell, or None for a blank one."""
    return float(text) if text not in (None, "") else None


def parse_matches(csv_text):
    """CSV rows as dicts with the fields we use: date, clubs, score and average odds."""
    matches = []
    for row in csv.DictReader(io.StringIO(csv_text.lstrip("﻿"))):
        if row.get("Div") not in (None, "E0") or not row.get("HomeTeam"):
            continue
        matches.append({
            "date": datetime.strptime(row["Date"], "%d/%m/%Y").date().isoformat(),
            "home": row["HomeTeam"],
            "away": row["AwayTeam"],
            "home_goals": _number(row.get("FTHG")),
            "away_goals": _number(row.get("FTAG")),
            "odds": [_number(row.get(column)) for column in ("AvgH", "AvgD", "AvgA", "Avg>2.5", "Avg<2.5")],
        })
    return matches


def download(path, client):
    """One CSV file from football-data.co.uk as text. Raises OddsError on failure."""
    try:
        response = client.get(f"{BASE_URL}/{path}")
    except httpx.HTTPError as error:
        raise OddsError(f"Couldn't reach football-data.co.uk for {path}: {error}") from error
    if response.status_code != 200:
        raise OddsError(f"football-data.co.uk returned HTTP {response.status_code} for {path}")
    return response.text


def cached_csv(storage, client, path, refresh):
    """Parsed matches for one file, from the cache unless `refresh` says it's stale.

    `refresh` is a function taking the cached fetch time (or None) and
    returning True if the file should be downloaded again.
    """
    name = f"odds/{path}"
    cached = storage.load_raw(name)
    if cached is not None and not refresh(cached["fetchedAt"]):
        return cached["matches"]
    matches = parse_matches(download(path, client))
    storage.save_raw(name, {"fetchedAt": datetime.now(timezone.utc).isoformat(), "matches": matches})
    return matches


def is_stale(fetched_at):
    """True once a cached file is older than REFRESH_HOURS."""
    age = datetime.now(timezone.utc) - datetime.fromisoformat(fetched_at)
    return age > timedelta(hours=REFRESH_HOURS)


def load_odds_data(storage, current_season_start, client=None):
    """Every season's results since FIRST_SEASON plus the next round's odds.

    Returns {"results": [match, ...] oldest season first, "upcoming": [match, ...]}.
    """
    client = client or httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "SquadSense"})
    results = []
    for start in range(FIRST_SEASON, current_season_start + 1):
        path = f"mmz4281/{season_code(start)}/E0.csv"
        refresh = is_stale if start == current_season_start else (lambda fetched_at: False)
        results.extend(cached_csv(storage, client, path, refresh))
    upcoming = cached_csv(storage, client, "fixtures.csv", is_stale)
    return {"results": results, "upcoming": upcoming}


def fair_probabilities(prices):
    """Bookmaker prices to chances that add up to 1 (the margin spread evenly)."""
    inverse = [1 / price for price in prices]
    total = sum(inverse)
    return [value / total for value in inverse]


def _poisson_table(rates):
    """P(goals = k) for k in 0..MAX_GOALS, one row per rate."""
    goals = numpy.arange(MAX_GOALS + 1)
    log_factorials = numpy.cumsum(numpy.log(numpy.maximum(goals, 1)))
    return numpy.exp(goals * numpy.log(rates)[:, None] - rates[:, None] - log_factorials)


# Every (home rate, away rate) pair on a grid, with the match chances each implies.
_RATES = numpy.arange(0.2, 4.01, 0.05)
_TABLE = _poisson_table(_RATES)
_JOINT = _TABLE[:, None, :, None] * _TABLE[None, :, None, :]  # [home rate, away rate, home goals, away goals]
_HOME_GOALS = numpy.arange(MAX_GOALS + 1)[:, None]
_AWAY_GOALS = numpy.arange(MAX_GOALS + 1)[None, :]
_GRID_CHANCES = numpy.stack([
    (_JOINT * (_HOME_GOALS > _AWAY_GOALS)).sum(axis=(2, 3)),
    (_JOINT * (_HOME_GOALS == _AWAY_GOALS)).sum(axis=(2, 3)),
    (_JOINT * (_HOME_GOALS < _AWAY_GOALS)).sum(axis=(2, 3)),
    (_JOINT * (_HOME_GOALS + _AWAY_GOALS > 2)).sum(axis=(2, 3)),
], axis=-1)


def expected_goals_from_odds(odds):
    """(home expected goals, away expected goals) that best match the odds, or None.

    `odds` is [home, draw, away, over 2.5, under 2.5] average prices.
    """
    if any(price is None or price <= 1 for price in odds):
        return None
    home, draw, away = fair_probabilities(odds[:3])
    over, _ = fair_probabilities(odds[3:])
    target = numpy.array([home, draw, away, over])
    errors = ((_GRID_CHANCES - target) ** 2).sum(axis=-1)
    home_index, away_index = numpy.unravel_index(numpy.argmin(errors), errors.shape)
    return float(_RATES[home_index]), float(_RATES[away_index])


def market_goals(matches, teams, fixtures, first_week, last_week):
    """{(team_id, opponent_id, is_home): expected goals} for fixtures with odds.

    Odds rows are matched to FPL fixtures by the two clubs and the date.
    """
    ids_by_name = {odds_name(team["name"]): team["id"] for team in teams}
    wanted = {}
    for fixture in fixtures:
        if fixture.get("event") is None or not first_week <= fixture["event"] <= last_week or not fixture.get("kickoff_time"):
            continue
        wanted[(fixture["team_h"], fixture["team_a"], fixture["kickoff_time"][:10])] = fixture
    goals = {}
    for match in matches:
        home_id, away_id = ids_by_name.get(match["home"]), ids_by_name.get(match["away"])
        if (home_id, away_id, match["date"]) not in wanted:
            continue
        rates = expected_goals_from_odds(match["odds"])
        if rates:
            goals[(home_id, away_id, True)] = rates[0]
            goals[(away_id, home_id, False)] = rates[1]
    return goals
