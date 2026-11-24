"""Tests for moves marked "Done on FPL": applying them to the squad, the
after-deadline check and how the emails list them.

Run from the jobs/ folder with:  python -m pytest tests/test_made_moves.py
"""

from squadsense import alerts, briefs
from squadsense.squad_state import SquadState, apply_made_moves, marked_move_mismatches

PLAYERS = {1: {"now_cost": 60}, 2: {"now_cost": 50}, 3: {"now_cost": 80}, 4: {"now_cost": 45}, 5: {"now_cost": 55}}


def squad(free_transfers=1):
    """Players 1 and 2 owned, 1 bank of £1.0m."""
    return SquadState(
        team_id=7, gameweek=12, bank=10, free_transfers=free_transfers, player_ids=[1, 2],
        captain_id=1, vice_captain_id=2, selling_prices={1: 58, 2: 50}, purchase_prices={1: 55, 2: 50},
    )


def mark(out, into, price_in):
    return {"gameweek": 12, "out": out, "in": into, "priceIn": price_in}


def test_a_mark_swaps_the_players_and_pays_for_the_new_one():
    state, applied, skipped = apply_made_moves(squad(), [mark(1, 3, 80)], PLAYERS)
    assert state.player_ids == [3, 2]
    assert state.bank == 10 + 58 - 80
    assert state.purchase_prices[3] == 80 and state.selling_prices[3] == 80
    assert 1 not in state.selling_prices
    assert state.free_transfers == 0
    assert state.captain_id == 3
    assert applied == [mark(1, 3, 80)] and skipped == []


def test_a_mark_that_does_not_fit_the_squad_is_skipped():
    marks = [mark(4, 5, 55), mark(1, 2, 50)]  # 4 isn't owned; 2 is owned already
    state, applied, skipped = apply_made_moves(squad(), marks, PLAYERS)
    assert state.player_ids == [1, 2] and state.bank == 10
    assert applied == [] and skipped == marks


def test_two_marks_use_two_transfers_but_never_below_zero():
    state, applied, _ = apply_made_moves(squad(), [mark(1, 3, 80), mark(2, 4, 45)], PLAYERS)
    assert state.player_ids == [3, 4]
    assert state.free_transfers == 0
    assert len(applied) == 2


def test_a_first_week_stays_unlimited():
    state, _, _ = apply_made_moves(squad(free_transfers=None), [mark(1, 3, 80)], PLAYERS)
    assert state.free_transfers is None


def test_a_bought_player_who_rose_since_sells_for_half_the_rise():
    rising = {**PLAYERS, 3: {"now_cost": 82}}
    state, _, _ = apply_made_moves(squad(), [mark(1, 3, 80)], rising)
    assert state.selling_prices[3] == 81


def test_marked_move_mismatches_finds_moves_missing_from_the_real_squad():
    marks = [mark(1, 3, 80), mark(2, 4, 45)]
    assert marked_move_mismatches(marks, [3, 2, 9]) == [mark(2, 4, 45)]
    assert marked_move_mismatches(marks, [3, 4]) == []


def test_mismatch_alert_names_the_move_once():
    snapshot = {"gameweek": 13, "players": {"2": {"name": "Saka"}, "4": {"name": "Palmer"}},
                "madeMoveMismatches": [{"gameweek": 12, "out": 2, "in": 4, "priceIn": 45}]}
    alert = alerts.made_move_mismatch_alert(snapshot)[0]
    assert alert.title == "A move you marked isn't in your FPL team"
    assert "Saka → Palmer" in alert.body
    assert alert.keys == ["made-mismatch-12-2"]
    assert alerts.made_move_mismatch_alert({"madeMoveMismatches": []}) == []


def test_brief_lists_done_moves_before_the_plan():
    snapshot = {
        "gameweek": 12, "players": {"1": {"name": "Raya"}, "3": {"name": "Sánchez"}},
        "madeMoves": [{"out": 1, "in": 3, "priceIn": 50}],
        "solverPlan": {"weeks": [{"moves": [], "captain": 3}]},
        "captainOptions": [], "chipPlan": None,
    }
    rows = briefs.plan_rows(snapshot)
    assert rows[0] == briefs.Row("Transfer", "Raya → Sánchez", "DONE")
    assert rows[1].value == "No more this week."
