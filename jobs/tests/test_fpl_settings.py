"""Tests for reading FPL's scoring and squad rules from bootstrap-static.

Run from the jobs/ folder with:  python -m pytest tests/test_fpl_settings.py
"""

import copy

from squadsense import alerts, rules

# FPL's published values for 2026/27, the same as the typed-in defaults.
GAME_CONFIG = {
    "scoring": {
        "long_play": 2, "short_play": 1, "assists": 3,
        "goals_scored": {"GKP": 10, "DEF": 6, "MID": 5, "FWD": 4},
        "clean_sheets": {"GKP": 4, "DEF": 4, "MID": 1, "FWD": 0},
        "defensive_contribution": {"GKP": 0, "DEF": 2, "MID": 2, "FWD": 2},
    },
}
GAME_SETTINGS = {"squad_team_limit": 3, "squad_total_spend": 1000, "max_extra_free_transfers": 4}
ELEMENT_TYPES = [
    {"id": 1, "squad_select": 2, "squad_min_play": 1, "squad_max_play": 1},
    {"id": 2, "squad_select": 5, "squad_min_play": 3, "squad_max_play": 5},
    {"id": 3, "squad_select": 5, "squad_min_play": 2, "squad_max_play": 5},
    {"id": 4, "squad_select": 3, "squad_min_play": 1, "squad_max_play": 3},
]


def bootstrap(**changes):
    """A bootstrap-static with FPL's settings, after applying `changes` (a function per section)."""
    data = {"game_config": copy.deepcopy(GAME_CONFIG), "game_settings": dict(GAME_SETTINGS), "element_types": copy.deepcopy(ELEMENT_TYPES)}
    for change in changes.values():
        change(data)
    return data


def test_same_values_give_no_differences():
    assert rules.apply_fpl_settings(bootstrap()) == []


def test_a_changed_goal_value_is_used_and_reported():
    def richer_midfield_goals(data):
        data["game_config"]["scoring"]["goals_scored"]["MID"] = 6

    differences = rules.apply_fpl_settings(bootstrap(goal=richer_midfield_goals))
    assert rules.POINTS_FOR_GOAL[rules.MIDFIELDER] == 6
    assert differences == ["Points for a MID goal: 5 now 6"]


def test_squad_rules_are_read():
    def looser_rules(data):
        data["game_settings"].update(squad_team_limit=4, max_extra_free_transfers=5)

    differences = rules.apply_fpl_settings(bootstrap(squad=looser_rules))
    assert rules.MAX_PER_CLUB == 4
    assert rules.MAX_BANKED_FREE_TRANSFERS == 6
    assert len(differences) == 2


def test_defensive_contribution_is_per_position():
    rules.apply_fpl_settings(bootstrap())
    assert rules.POINTS_FOR_DEFENSIVE_CONTRIBUTION[rules.GOALKEEPER] == 0
    assert rules.POINTS_FOR_DEFENSIVE_CONTRIBUTION[rules.DEFENDER] == 2


def test_missing_settings_keep_the_defaults():
    assert rules.apply_fpl_settings({"element_types": [{"id": 1}]}) == []
    assert rules.POINTS_FOR_GOAL[rules.FORWARD] == 4
    assert rules.SQUAD_SHAPE[rules.GOALKEEPER] == 2


def test_a_missing_value_keeps_its_default():
    def no_assist_value(data):
        data["game_config"]["scoring"]["assists"] = None

    assert rules.apply_fpl_settings(bootstrap(assist=no_assist_value)) == []
    assert rules.POINTS_FOR_ASSIST == 3


def test_use_defaults_puts_everything_back():
    def harsh_rules(data):
        data["game_config"]["scoring"]["assists"] = 1
        data["element_types"][1]["squad_min_play"] = 4

    rules.apply_fpl_settings(bootstrap(harsh=harsh_rules))
    rules.use_defaults()
    assert rules.POINTS_FOR_ASSIST == 3
    assert rules.MIN_STARTERS[rules.DEFENDER] == 3


def test_rule_change_alert_once_per_change():
    snapshot = {"ruleChanges": ["Points for a MID goal: 5 now 6"]}
    alert = alerts.rule_change_alert(snapshot)[0]
    assert alert.title == "FPL changed its rules"
    assert "Points for a MID goal: 5 now 6" in alert.body
    assert alert.keys == alerts.rule_change_alert(snapshot)[0].keys
    assert alerts.rule_change_alert({"ruleChanges": []}) == []
    assert alerts.rule_change_alert({}) == []
