"""Tests for loading past seasons and for the backtest itself.

They use a tiny made-up season written to a temporary folder, so they
don't need the real downloads.
"""

import csv

from squadsense import model
from squadsense.backtest import model_settings, starter_predictions, week_contexts
from squadsense.past_seasons import load_season

TEAMS = [
    {"id": 1, "name": "Home FC", "short_name": "HOM", "strength": 4},
    {"id": 2, "name": "Away FC", "short_name": "AWY", "strength": 2},
]
GW_COLUMNS = ["name", "position", "element", "fixture", "round", "was_home", "minutes", "total_points",
              "expected_goals", "expected_assists", "goals_scored", "assists", "bonus", "saves", "value"]


def write_csv(path, columns, rows):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def make_season(folder, week_six_points=6):
    """Six weeks of Home FC v Away FC, a striker on each side, plus one assistant manager row."""
    folder.mkdir()
    write_csv(folder / "teams.csv", ["id", "name", "short_name", "strength"], TEAMS)
    fixtures = [{"id": week, "event": week, "finished": "True", "team_h": 1, "team_a": 2,
                 "team_h_difficulty": 2, "team_a_difficulty": 4} for week in range(1, 7)]
    write_csv(folder / "fixtures.csv", list(fixtures[0]), fixtures)
    rows = []
    for week in range(1, 7):
        rows.append({"name": "Striker H", "position": "FWD", "element": 10, "fixture": week, "round": week, "was_home": "True",
                     "minutes": 90, "total_points": week_six_points if week == 6 else 6, "expected_goals": "0.60",
                     "expected_assists": "0.10", "goals_scored": 1, "assists": 0, "bonus": 2, "saves": 0, "value": 80})
        rows.append({"name": "Striker A", "position": "FWD", "element": 20, "fixture": week, "round": week, "was_home": "False",
                     "minutes": 90, "total_points": 2, "expected_goals": "0.20", "expected_assists": "0.05",
                     "goals_scored": 0, "assists": 0, "bonus": 0, "saves": 0, "value": 60})
    rows.append({"name": "A Manager", "position": "AM", "element": 99, "fixture": 1, "round": 1, "was_home": "True",
                 "minutes": 90, "total_points": 3, "expected_goals": "0", "expected_assists": "0",
                 "goals_scored": 0, "assists": 0, "bonus": 0, "saves": 0, "value": 5})
    write_csv(folder / "merged_gw.csv", GW_COLUMNS, rows)
    return load_season(folder)


def test_past_season_converts_to_api_shapes(tmp_path):
    season = make_season(tmp_path / "2099-00")
    assert season.teams[0]["strength_overall_home"] == 4  # 1-5 rating moved where the model reads it
    assert 99 not in season.players  # assistant manager rows skipped
    rows = season.histories[20]
    assert [row["round"] for row in rows] == list(range(1, 7))
    assert rows[0]["team"] == 2 and rows[0]["was_home"] is False
    assert rows[0]["defensive_contribution"] == 0


def test_backtest_never_sees_the_week_it_predicts(tmp_path):
    # Two seasons that only differ in GW6's real points: GW4 and GW5
    # predictions must be identical, and GW6's prediction too.
    normal = make_season(tmp_path / "normal")
    changed = make_season(tmp_path / "changed", week_six_points=20)
    for normal_context, changed_context in zip(week_contexts(normal), week_contexts(changed)):
        predicted_normal = [item.predicted for item in starter_predictions(normal, normal_context)]
        predicted_changed = [item.predicted for item in starter_predictions(changed, changed_context)]
        assert predicted_normal == predicted_changed


def test_model_settings_always_restores_the_real_weights():
    original_prior, original_bonus = model.PRIOR_MINUTES, model.POSITION_PRIORS[4]["bonus"]
    try:
        with model_settings(PRIOR_MINUTES=1, bonus_FWD=9.9):
            assert model.PRIOR_MINUTES == 1 and model.POSITION_PRIORS[4]["bonus"] == 9.9
            raise RuntimeError("something went wrong mid-backtest")
    except RuntimeError:
        pass
    assert model.PRIOR_MINUTES == original_prior
    assert model.POSITION_PRIORS[4]["bonus"] == original_bonus
