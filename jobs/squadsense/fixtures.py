"""Turns each club's attack and defence ratings into expected goals per fixture.

FPL used to publish attack and defence strength ratings, but in 2026/27
they're all zero. The only rating left is an overall 1-5 score. So we
build our own ratings from this season's matches: how much xG each club
creates and allows per game, compared with the league average. Early in
the season that's a small sample, so each club starts from a guess based
on FPL's 1-5 rating and moves towards its own numbers as games pile up.

The expected goals number drives both attacker and defender scores:

- attackers want their team's expected goals to be high
- defenders and keepers want the opponent's expected goals to be low,
  because P(clean sheet) = e^(-goals the opponent is expected to score)
"""

import math
from collections import defaultdict

# Average goals per team per Premier League match, recent seasons.
LEAGUE_AVERAGE_GOALS = 1.4
HOME_BOOST = 1.1
AWAY_PENALTY = 0.9
# Each later week in the planning window counts 10% less than the one before.
WEEKLY_DISCOUNT = 0.9
# How many games' worth of weight the starting guess gets. With 6, a club
# that has played 10 games is 10/16 its own numbers and 6/16 the guess.
PRIOR_GAMES = 6  # starting assumption
# How far one step on FPL's 1-5 overall rating moves the starting guess.
RATING_STEP = 0.12  # starting assumption


def _average(values):
    values = list(values)
    return sum(values) / len(values)


def _blend(own_rate, guessed_rate, games_played):
    """Weighted mix of a club's own rate and the guess; more games, more own rate."""
    return (games_played * own_rate + PRIOR_GAMES * guessed_rate) / (games_played + PRIOR_GAMES)


def starting_ratings(teams):
    """A first guess at each club's ratings from FPL's 1-5 overall score.

    Ratings are multipliers where 1.0 is league average. "attack" above 1
    means the club scores more than average; "concede" above 1 means it
    lets in more than average.
    """
    overall = {team["id"]: (team["strength_overall_home"] + team["strength_overall_away"]) / 2 for team in teams}
    mean_overall = _average(overall.values())
    return {
        team_id: {"attack": 1 + RATING_STEP * (score - mean_overall), "concede": 1 - RATING_STEP * (score - mean_overall)}
        for team_id, score in overall.items()
    }


def team_match_xg(fixtures, histories):
    """xG for and against in every finished match, as {team_id: [(xg_for, xg_against), ...]}.

    Adds up each player's xG per match. A history row only says whether
    the player was at home, so the fixture tells us which club that was.
    """
    finished = {fixture["id"]: fixture for fixture in fixtures if fixture.get("finished")}
    xg_by_fixture_and_team = defaultdict(float)
    for rows in histories.values():
        for row in rows:
            fixture = finished.get(row["fixture"])
            if fixture is None:
                continue  # not finished yet
            team_id = fixture["team_h"] if row["was_home"] else fixture["team_a"]
            xg_by_fixture_and_team[(fixture["id"], team_id)] += float(row.get("expected_goals") or 0)

    matches = defaultdict(list)
    for fixture in finished.values():
        home_xg = xg_by_fixture_and_team[(fixture["id"], fixture["team_h"])]
        away_xg = xg_by_fixture_and_team[(fixture["id"], fixture["team_a"])]
        matches[fixture["team_h"]].append((home_xg, away_xg))
        matches[fixture["team_a"]].append((away_xg, home_xg))
    return matches


def team_ratings(teams, fixtures, histories):
    """Each club's attack and concede ratings, blending real xG with the starting guess."""
    guesses = starting_ratings(teams)
    matches = team_match_xg(fixtures, histories)
    all_xg = [xg_for for games in matches.values() for xg_for, _ in games]
    if not all_xg or sum(all_xg) == 0:
        return guesses  # no finished matches yet, e.g. before GW1
    league_xg = _average(all_xg)

    ratings = {}
    for team_id, guess in guesses.items():
        games = matches.get(team_id, [])
        own_attack = _average(xg_for for xg_for, _ in games) / league_xg if games else 1.0
        own_concede = _average(xg_against for _, xg_against in games) / league_xg if games else 1.0
        ratings[team_id] = {
            "attack": _blend(own_attack, guess["attack"], len(games)),
            "concede": _blend(own_concede, guess["concede"], len(games)),
        }
    return ratings


class FixtureModel:
    """Expected goals for and against for any fixture, from team ratings."""

    def __init__(self, ratings):
        self.ratings = ratings

    def expected_goals(self, team_id, opponent_id, is_home):
        """Goals `team_id` should score against `opponent_id`."""
        venue = HOME_BOOST if is_home else AWAY_PENALTY
        return (
            LEAGUE_AVERAGE_GOALS
            * self.ratings[team_id]["attack"]
            * self.ratings[opponent_id]["concede"]
            * venue
        )

    def clean_sheet_chance(self, team_id, opponent_id, is_home):
        """Chance `team_id` keeps a clean sheet, using a Poisson model."""
        goals_against = self.expected_goals(opponent_id, team_id, not is_home)
        return math.exp(-goals_against)


def fixtures_by_team_and_week(fixtures, first_week, last_week):
    """Groups fixtures into {team_id: {gameweek: [match, ...]}}.

    A gameweek with two matches is a double; one with none is a blank.
    Each match is a dict with the opponent, home or away, and FPL's own
    1-5 difficulty rating for reference.
    """
    schedule = defaultdict(lambda: defaultdict(list))
    for fixture in fixtures:
        week = fixture.get("event")
        if week is None or not first_week <= week <= last_week:
            continue  # unscheduled or outside the window
        schedule[fixture["team_h"]][week].append(
            {"opponent": fixture["team_a"], "is_home": True, "fpl_difficulty": fixture["team_h_difficulty"]}
        )
        schedule[fixture["team_a"]][week].append(
            {"opponent": fixture["team_h"], "is_home": False, "fpl_difficulty": fixture["team_a_difficulty"]}
        )
    return schedule


def window_scores(fixture_model, schedule, team_ids, first_week, last_week):
    """Scores each team's run of fixtures for attackers and for defenders.

    Attack score adds up expected goals; defence score adds up clean-sheet
    chances. Later weeks are discounted, blanks add nothing and doubles
    add both matches. Higher is better for both.
    """
    scores = {}
    for team_id in team_ids:
        attack_total = 0.0
        defence_total = 0.0
        for offset, week in enumerate(range(first_week, last_week + 1)):
            weight = WEEKLY_DISCOUNT ** offset
            for match in schedule[team_id].get(week, []):
                attack_total += weight * fixture_model.expected_goals(team_id, match["opponent"], match["is_home"])
                defence_total += weight * fixture_model.clean_sheet_chance(team_id, match["opponent"], match["is_home"])
        scores[team_id] = {"attack": round(attack_total, 2), "defence": round(defence_total, 2)}
    return scores
