"""Elo ratings for Premier League clubs, worked out from past results.

Elo is a single strength number per club. After every match the winner
takes points from the loser; a surprise result moves more points than an
expected one, and a bigger winning margin moves more too. It's the idea
behind ClubElo (clubelo.com), whose free API wasn't working when this
was written, so we compute our own from football-data.co.uk results.

A promoted club starts at the average final rating of the clubs that
went down, since we only follow the Premier League.

The fixture model uses Elo for each club's starting guess before this
season's xG has piled up (see fixtures.starting_ratings).
"""

from collections import defaultdict

from .odds import odds_name

START_RATING = 1500
K_FACTOR = 20
HOME_ADVANTAGE = 60  # Elo points, roughly what home teams win by on average


def win_expectancy(rating, opponent_rating, is_home):
    """Chance-weighted result (1 win, 0.5 draw) the rating difference predicts."""
    difference = rating - opponent_rating + (HOME_ADVANTAGE if is_home else -HOME_ADVANTAGE)
    return 1 / (1 + 10 ** (-difference / 400))


def margin_multiplier(goal_difference):
    """Bigger wins move ratings more: x1 for one goal, x1.5 for two, then (11 + margin) / 8."""
    margin = abs(goal_difference)
    if margin <= 1:
        return 1.0
    if margin == 2:
        return 1.5
    return (11 + margin) / 8


def season_of(date):
    """The season a match date belongs to, as its starting year (August to July)."""
    year, month = int(date[:4]), int(date[5:7])
    return year if month >= 7 else year - 1


def ratings_before(results, before_date):
    """Elo from every result played before `before_date` (an ISO date).

    `results` are odds.parse_matches() rows, in any order. Returns
    ({club name: Elo}, the clubs in the latest season played).
    """
    ratings = defaultdict(lambda: START_RATING)
    played = sorted((match for match in results if match["date"] < before_date and match["home_goals"] is not None), key=lambda match: match["date"])
    season_clubs = defaultdict(set)
    for match in played:
        season_clubs[season_of(match["date"])].update((match["home"], match["away"]))

    current_season = None
    for match in played:
        season = season_of(match["date"])
        if season != current_season:
            _welcome_promoted(ratings, season_clubs.get(season - 1, set()), season_clubs[season])
            current_season = season
        _update(ratings, match)
    return dict(ratings), season_clubs.get(current_season, set())


def _welcome_promoted(ratings, last_season, this_season):
    """Starts each promoted club at the average final rating of the relegated ones."""
    relegated = last_season - this_season
    promoted = this_season - last_season
    if not last_season or not relegated:
        return
    entry_rating = sum(ratings[club] for club in relegated) / len(relegated)
    for club in promoted:
        ratings[club] = entry_rating


def _update(ratings, match):
    """Moves both clubs' ratings after one result."""
    home, away = match["home"], match["away"]
    expected = win_expectancy(ratings[home], ratings[away], is_home=True)
    goal_difference = match["home_goals"] - match["away_goals"]
    actual = 1.0 if goal_difference > 0 else 0.5 if goal_difference == 0 else 0.0
    change = K_FACTOR * margin_multiplier(goal_difference) * (actual - expected)
    ratings[home] += change
    ratings[away] -= change


def club_ratings(results, teams, before_date):
    """{FPL team id: Elo} for this season's clubs, or {} if there are no results at all.

    A club with no Premier League results yet (promoted, before the
    season's first match) gets the average of the latest season's bottom three.
    """
    ratings, latest_clubs = ratings_before(results, before_date)
    if not ratings:
        return {}
    bottom_three = sorted(ratings[club] for club in latest_clubs)[:3]
    fallback = sum(bottom_three) / len(bottom_three)
    return {team["id"]: ratings.get(odds_name(team["name"]), fallback) for team in teams}
