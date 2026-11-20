"""Data for the Fixture Ticker page: every club's next few gameweeks.

Each match gets two difficulty ratings from 1 (easiest) to 5 (hardest),
the same direction as FPL's own fixture ratings:

- for attackers, from the goals the club is expected to score
- for defenders, from the club's chance of a clean sheet

Ratings are relative. All matches in the ticker are split into five
equal-sized groups, so there's always a spread of colors to compare.
"""

from .fixtures import fixtures_by_team_and_week, window_scores

TICKER_WEEKS = 8
TICKER_WINDOWS = (3, 5, 8)
LAST_GAMEWEEK = 38


def difficulty_cut_points(values):
    """The four values that split `values` into five equal-sized groups."""
    ordered = sorted(values)
    return [ordered[len(ordered) * step // 5] for step in (1, 2, 3, 4)]


def difficulty(value, cut_points):
    """1 for the easiest fifth of matches up to 5 for the hardest.

    Higher values are easier here (more expected goals, a better
    clean-sheet chance), so passing more cut points means easier.
    """
    cut_points_passed = sum(1 for cut_point in cut_points if value >= cut_point)
    return 5 - cut_points_passed


def ticker_weeks(first_week):
    """The gameweeks shown, stopping at GW38 near the end of the season."""
    return list(range(first_week, min(first_week + TICKER_WEEKS - 1, LAST_GAMEWEEK) + 1))


def match_cells(fixture_model, schedule, teams_by_id, weeks):
    """Every club's matches per week, with both difficulty ratings filled in."""
    raw = {}
    for team_id in teams_by_id:
        raw[team_id] = {
            week: [
                {
                    "opponent": teams_by_id[match["opponent"]]["short_name"],
                    "isHome": match["is_home"],
                    "goals": fixture_model.expected_goals(team_id, match["opponent"], match["is_home"]),
                    "cleanSheet": fixture_model.clean_sheet_chance(team_id, match["opponent"], match["is_home"]),
                }
                for match in schedule[team_id].get(week, [])
            ]
            for week in weeks
        }

    all_matches = [match for weeks_for_team in raw.values() for matches in weeks_for_team.values() for match in matches]
    if not all_matches:
        return raw  # nothing scheduled, e.g. after the last gameweek
    attack_cuts = difficulty_cut_points(match["goals"] for match in all_matches)
    defence_cuts = difficulty_cut_points(match["cleanSheet"] for match in all_matches)
    for match in all_matches:
        match["attackDifficulty"] = difficulty(match.pop("goals"), attack_cuts)
        match["defenceDifficulty"] = difficulty(match.pop("cleanSheet"), defence_cuts)
    return raw


def build_ticker(fixture_model, fixtures, teams, first_week):
    """Everything the Fixture Ticker page needs, ready to drop into the snapshot.

    Scores come from fixtures.window_scores: expected goals for attackers,
    expected clean sheets for defenders, with later weeks counting less.
    One set of scores per window length the page offers.
    """
    weeks = ticker_weeks(first_week)
    schedule = fixtures_by_team_and_week(fixtures, weeks[0], weeks[-1])
    teams_by_id = {team["id"]: team for team in teams}
    cells = match_cells(fixture_model, schedule, teams_by_id, weeks)

    scores_by_window = {
        window: window_scores(fixture_model, schedule, list(teams_by_id), weeks[0], weeks[min(window, len(weeks)) - 1])
        for window in TICKER_WINDOWS
    }
    return {
        "weeks": weeks,
        "windows": list(TICKER_WINDOWS),
        "teams": [
            {
                "id": team_id,
                "name": team["short_name"],
                "matches": {str(week): cells[team_id][week] for week in weeks},
                "scores": {
                    "attack": {str(window): scores[team_id]["attack"] for window, scores in scores_by_window.items()},
                    "defence": {str(window): scores[team_id]["defence"] for window, scores in scores_by_window.items()},
                },
            }
            for team_id, team in teams_by_id.items()
        ],
    }
