"""Tests for the data jobs, run against the made-up sample data.

Run from the jobs/ folder with:  python -m pytest
"""

import pytest

from squadsense import rules
from squadsense.captaincy import outcome_chances
from squadsense.chips import ChipValue, best_chip_weeks
from squadsense.fixtures import FixtureModel, fixtures_by_team_and_week, starting_ratings, team_ratings
from squadsense.fpl_client import FplApiError, FplClient
from squadsense.planner import best_lineup
from squadsense.player_detail import recent_gameweeks
from squadsense.model import POSITION_PRIORS, starting_rates
from squadsense.price_watch import prediction_label, price_timing_note
from squadsense.squad_builder import pick_best_squad
from squadsense.ticker import difficulty, difficulty_cut_points
from squadsense.squad_state import build_squad_state, count_free_transfers
from squadsense.sync import run, starting_price_lookup_from
from tests.sample_data import CURRENT_WEEK, TEAM_ID, FakeHttpClient, build_sample


@pytest.fixture(autouse=True)
def no_odds_download(monkeypatch):
    """Tests never call football-data.co.uk; the odds tests below use made-up files."""
    monkeypatch.setattr("squadsense.sync.market_expected_goals", lambda *args, **kwargs: {})


@pytest.fixture(autouse=True)
def plan_transfers_without_chips(monkeypatch):
    """Planning chips inside the five-week plan takes about 30 seconds a sync,
    so most tests leave it out. The chip test below turns it back on."""
    monkeypatch.setattr("squadsense.strategy.SOLVER_CHIPS", ())
    monkeypatch.setattr("squadsense.strategy.SENSITIVITY_RUNS", 0)


@pytest.fixture(scope="module")
def sample():
    return build_sample()


@pytest.fixture
def fake_client(sample):
    return FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(sample))


def test_selling_price_keeps_half_the_rise_rounded_down():
    assert rules.selling_price(purchase_price=60, current_price=63) == 61
    assert rules.selling_price(purchase_price=60, current_price=58) == 58


def test_check_squad_catches_club_limit():
    four_from_one_club = [{"element_type": 2, "team": 1}] * 4
    problems = rules.check_squad(four_from_one_club, bank=0)
    assert any("limit is 3" in problem for problem in problems)


def test_free_transfers_bank_to_five_and_survive_a_wildcard():
    history = [{"event": week, "event_transfers": {5: 1, 8: 2, 11: 1}.get(week, 0)} for week in range(1, 13)]
    chips = [{"name": "wildcard", "event": 7}]
    assert count_free_transfers(history, chips, next_gameweek=13, started_event=1) == 5


def test_late_joiner_counts_free_transfers_from_their_first_week():
    # A team created for GW11 has made no transfers yet, so it has 1 for
    # GW12, not the 5 it would bank by counting empty weeks from GW2.
    history = [{"event": 11, "event_transfers": 0}]
    assert count_free_transfers(history, [], next_gameweek=12, started_event=11) == 1
    history.append({"event": 12, "event_transfers": 0})
    assert count_free_transfers(history, [], next_gameweek=13, started_event=11) == 2


def test_late_joiner_purchase_price_comes_from_their_first_week():
    rows = [{"round": 1, "value": 60}, {"round": 10, "value": 64}, {"round": 11, "value": 65}]
    lookup = starting_price_lookup_from({7: rows}, started_event=11)
    assert lookup(7) == 65
    # Before the team's first gameweek has been played, there's no price to find.
    assert starting_price_lookup_from({7: rows[:2]}, started_event=11)(7) is None


def test_client_adds_trailing_slash_and_reports_missing_paths(sample):
    fake_http = FakeHttpClient(sample)
    client = FplClient(min_seconds_between_requests=0, http_client=fake_http)
    client.get("fixtures")
    assert fake_http.requested[-1] == "fixtures/"
    with pytest.raises(FplApiError):
        client.get("not-a-real-endpoint/")


def test_blank_and_double_gameweeks(sample):
    schedule = fixtures_by_team_and_week(sample["fixtures/"], 13, 17)
    liverpool, arsenal = 7, 1
    assert schedule[liverpool].get(16, []) == []
    assert len(schedule[arsenal][16]) == 2


def sample_histories(sample):
    """The sample's player histories, keyed by player id like storage returns them."""
    return {
        int(path.split("/")[1]): body["history"]
        for path, body in sample.items() if path.startswith("element-summary/")
    }


def test_stronger_team_expects_more_goals(sample):
    teams = sample["bootstrap-static/"]["teams"]
    model = FixtureModel(team_ratings(teams, sample["fixtures/"], sample_histories(sample)))
    assert model.expected_goals(1, 20, True) > model.expected_goals(20, 1, False)


def test_ratings_follow_match_xg_and_fall_back_to_fpl_rating():
    teams = [
        {"id": 1, "strength_overall_home": 3, "strength_overall_away": 3},
        {"id": 2, "strength_overall_home": 3, "strength_overall_away": 3},
        {"id": 3, "strength_overall_home": 5, "strength_overall_away": 5},
    ]
    # Club 1 out-creates club 2 in their only match; club 3 hasn't played.
    fixtures = [{"id": 10, "team_h": 1, "team_a": 2, "finished": True}]
    histories = {
        100: [{"fixture": 10, "was_home": True, "expected_goals": "2.5"}],
        200: [{"fixture": 10, "was_home": False, "expected_goals": "0.5"}],
    }
    ratings = team_ratings(teams, fixtures, histories)
    assert ratings[1]["attack"] > ratings[2]["attack"]
    assert ratings[1]["concede"] < ratings[2]["concede"]
    # No matches, so club 3 keeps the guess from its higher FPL rating.
    assert ratings[3] == starting_ratings(teams)[3]
    assert ratings[3]["attack"] > 1 > ratings[3]["concede"]


def test_full_sync_builds_a_legal_lineup(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", tmp_path / "snapshot.json", client=fake_client)

    assert snapshot["gameweek"] == 13
    assert len(snapshot["squad"]) == 15
    lineup = snapshot["lineups"]["13"]
    starters = [snapshot["players"][str(pid)] for pid in lineup["starters"]]
    positions = [player["position"] for player in starters]
    assert len(starters) == 11 and positions.count("GK") == 1 and positions.count("DEF") >= 3
    assert (tmp_path / "snapshot.json").exists()


def test_suggestions_respect_budget(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    for move in snapshot["suggestions"]:
        assert move["bank_after"] >= 0
        assert snapshot["players"][str(move["out"])]["position"] == snapshot["players"][str(move["in"])]["position"]


def test_best_lineup_counts_captain_twice():
    players = {pid: {"element_type": pos} for pid, pos in enumerate([1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4])}
    xp = {pid: {13: float(pid)} for pid in players}
    lineup = best_lineup(list(players), players, xp, 13)
    assert rules.is_valid_formation([players[pid] for pid in lineup["starters"]])
    assert lineup["captain"] == 14
    assert lineup["expected_points"] == sum(xp[pid][13] for pid in lineup["starters"]) + 14


def make_pool():
    """A small made-up player pool: 3 clubs, enough of each position, varied prices."""
    pool = []
    for player_id in range(1, 41):
        position = [1, 2, 3, 4][player_id % 4]
        pool.append({"id": player_id, "element_type": position, "team": player_id % 8, "now_cost": 40 + player_id})
    return pool


def test_model_squad_is_legal_and_within_budget():
    pool = make_pool()
    players_by_id = {player["id"]: player for player in pool}
    # Pricier players score more, so the budget is what holds the solver back.
    expected_points = {player["id"]: {11: player["now_cost"] / 10} for player in pool}
    squad = pick_best_squad(pool, expected_points, 11, budget=900)

    chosen = [players_by_id[player_id] for player_id in squad]
    cost = sum(player["now_cost"] for player in chosen)
    assert len(squad) == 15
    assert rules.check_squad(chosen, bank=900 - cost) == []
    lineup = best_lineup(squad, players_by_id, expected_points, 11)
    assert rules.is_valid_formation([players_by_id[player_id] for player_id in lineup["starters"]])


def test_hidden_squad_falls_back_to_a_model_squad(tmp_path, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    # A team created this week: its first gameweek is the next one, so FPL
    # hasn't published its picks yet.
    responses = dict(sample)
    responses[f"entry/{TEAM_ID}/"] = {**sample[f"entry/{TEAM_ID}/"], "started_event": CURRENT_WEEK + 1}
    fake_http = FakeHttpClient(responses)
    client = FplClient(min_seconds_between_requests=0, http_client=fake_http)

    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=client)

    assert snapshot["squadSource"] == "model"
    assert snapshot["freeTransfers"] is None
    assert snapshot["suggestions"] == []
    assert len(snapshot["squad"]) == 15 and snapshot["bank"] >= 0
    assert not any(path.startswith(f"entry/{TEAM_ID}/event/") for path in fake_http.requested)


def test_difficulty_splits_matches_into_five_groups():
    values = [float(value) for value in range(1, 11)]
    cut_points = difficulty_cut_points(values)
    # Higher values (more goals, better clean-sheet chance) are easier.
    assert difficulty(10.0, cut_points) == 1
    assert difficulty(1.0, cut_points) == 5
    assert sorted({difficulty(value, cut_points) for value in values}) == [1, 2, 3, 4, 5]


def test_ticker_shows_blanks_doubles_and_window_scores(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    ticker = snapshot["fixtureTicker"]
    teams = {team["name"]: team for team in ticker["teams"]}

    assert ticker["weeks"] == list(range(13, 21))
    assert teams["LIV"]["matches"]["16"] == []
    assert len(teams["ARS"]["matches"]["16"]) == 2
    every_match = [match for team in ticker["teams"] for matches in team["matches"].values() for match in matches]
    assert all(1 <= match["attackDifficulty"] <= 5 for match in every_match)
    # A longer window adds more matches, so it can't score lower.
    assert teams["ARS"]["scores"]["attack"]["8"] >= teams["ARS"]["scores"]["attack"]["3"]


def test_prediction_labels_follow_fpl_likelihood():
    assert prediction_label(5, None) == "Changes tonight"
    assert prediction_label(-4, None) == "Very likely"
    assert prediction_label(0, None) == "No change"
    assert prediction_label(5, "2026-11-21T18:35:54Z") == "Price locked"


def test_price_watch_sorts_by_progress_and_flags_the_squad(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    watch = snapshot["priceWatch"]

    progress = [abs(row["progress"]) for row in watch["players"]]
    assert progress == sorted(progress, reverse=True)
    assert {row["id"] for row in watch["players"] if row["inSquad"]} == set(snapshot["squad"])
    rows_by_id = {row["id"]: row for row in watch["players"]}
    assert all(rows_by_id[player_id]["likelihood"] <= -3 for player_id in watch["atRisk"])
    assert all(rows_by_id[player_id]["likelihood"] >= 3 for player_id in watch["rising"])


def test_recent_gameweeks_adds_up_doubles():
    rows = [
        {"round": 9, "total_points": 2, "expected_goals": "0.1", "expected_assists": "0.0", "minutes": 90},
        {"round": 10, "total_points": 6, "expected_goals": "0.5", "expected_assists": "0.2", "minutes": 90},
        {"round": 10, "total_points": 3, "expected_goals": "0.3", "expected_assists": "0.1", "minutes": 70},
    ]
    weeks = recent_gameweeks(rows)
    assert [week["gameweek"] for week in weeks] == [9, 10]
    assert weeks[1] == {"gameweek": 10, "points": 9, "xg": 0.8, "xa": 0.3, "minutes": 160}


def test_every_player_gets_a_detail_entry(tmp_path, fake_client, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    details = snapshot["playerDetails"]

    assert len(details) == len(sample["bootstrap-static/"]["elements"])
    squad_player = details[str(snapshot["squad"][0])]
    assert squad_player["sellingPrice"] is not None
    assert len(squad_player["recent"]) == 6
    assert 1 <= len(squad_player["fixtures"]) <= 6


def test_chip_plan_never_puts_two_chips_in_one_week():
    # Bench Boost and Triple Captain both peak in GW16; only one can have it.
    values = {
        "bboost": {16: ChipValue(13.8, ""), 17: ChipValue(6.0, "")},
        "3xc": {16: ChipValue(17.0, ""), 18: ChipValue(9.0, "")},
    }
    plan = best_chip_weeks(values)
    assert plan["bboost"] != plan["3xc"]
    # Best total: TC in GW16 (17.0) with BB moved to GW17 (6.0) beats 13.8 + 9.0.
    assert plan == {"bboost": 17, "3xc": 16}


def test_chip_plan_marks_used_chips_and_recommends_open_weeks(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    chip_plan = snapshot["chipPlan"]
    cards = {card["chip"]: card for card in chip_plan["cards"]}

    assert (chip_plan["halfStart"], chip_plan["halfStop"]) == (1, 19)
    assert cards["wildcard"]["status"] == "used" and cards["wildcard"]["usedIn"] == 7
    chosen = [card["decision"]["week"] for card in cards.values() if card["decision"] and card["decision"]["action"] != "none"]
    assert len(chosen) == len(set(chosen))
    assert all(13 <= week <= 19 for week in chosen)
    assert chip_plan["timeline"][6]["used"] == ["WC"]


def test_bank_comes_from_picks_even_with_an_empty_history(sample):
    # Just after a new team's first deadline, its history list can be empty.
    picks = sample[f"entry/{TEAM_ID}/event/{CURRENT_WEEK}/picks/"]
    players_by_id = {player["id"]: player for player in sample["bootstrap-static/"]["elements"]}
    state = build_squad_state(
        TEAM_ID, CURRENT_WEEK + 1, CURRENT_WEEK, picks, {"current": [], "chips": []}, [],
        players_by_id, lambda player_id: None,
    )
    assert state.bank == 14
    assert state.free_transfers == 1


def test_free_hit_week_plans_with_the_squad_that_comes_back(tmp_path, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    responses = dict(sample)
    real_picks = sample[f"entry/{TEAM_ID}/event/{CURRENT_WEEK}/picks/"]
    real_squad = [pick["element"] for pick in real_picks["picks"]]
    # GW12 is a Free Hit with a different first player; GW11 holds the real squad.
    outsider = next(player["id"] for player in sample["bootstrap-static/"]["elements"]
                    if player["id"] not in real_squad and player["element_type"] == 1)
    free_hit_picks = [dict(pick, element=outsider) if index == 0 else pick for index, pick in enumerate(real_picks["picks"])]
    responses[f"entry/{TEAM_ID}/event/{CURRENT_WEEK}/picks/"] = {
        "active_chip": "freehit", "entry_history": {"event": CURRENT_WEEK, "bank": 0}, "picks": free_hit_picks,
    }
    responses[f"entry/{TEAM_ID}/event/{CURRENT_WEEK - 1}/picks/"] = real_picks
    history = sample[f"entry/{TEAM_ID}/history/"]
    responses[f"entry/{TEAM_ID}/history/"] = dict(history, chips=history["chips"] + [{"name": "freehit", "event": CURRENT_WEEK}])
    client = FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(responses))

    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=client)

    assert sorted(snapshot["squad"]) == sorted(real_squad)
    assert snapshot["bank"] == 14


def test_players_carry_their_recent_form(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path / "data", None, client=fake_client)
    player = snapshot["players"][str(snapshot["squad"][0])]
    assert len(player["form"]) == 6
    assert all(isinstance(points, int) for points in player["form"])


def test_past_season_moves_the_starting_point_towards_his_own_numbers():
    striker_last_season = [{"season_name": "2025/26", "minutes": 2700, "expected_goals": "21.00", "expected_assists": "3.00", "bonus": 20, "saves": 0}]
    start = starting_rates(rules.FORWARD, striker_last_season)
    assert POSITION_PRIORS[rules.FORWARD]["xg"] < start["xg"] < 0.7
    # Too few minutes last season, so only the position average is used.
    cameo = [dict(striker_last_season[0], minutes=100)]
    assert starting_rates(rules.FORWARD, cameo) == POSITION_PRIORS[rules.FORWARD]


def test_snapshot_carries_set_pieces_fpl_xp_and_past_seasons(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    player = next(iter(snapshot["players"].values()))
    assert set(player["setPieces"]) == {"penalties", "corners", "freeKicks"}
    assert player["fplXp"] is not None
    details = snapshot["playerDetails"]
    assert any(detail["pastSeasons"] for detail in details.values())
    assert all("season" in detail for detail in details.values())


def test_captain_options_carry_haul_and_blank_chances(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    for option in snapshot["captainOptions"]:
        assert 0 <= option["haulChance"] <= 1 and 0 <= option["blankChance"] <= 1


def test_blank_week_means_no_haul():
    assert outcome_chances({"id": 1, "element_type": 4, "team": 1}, None, [], None) == {"haulChance": 0.0, "blankChance": 1.0}


def test_price_note_warns_about_a_rise_before_buying():
    rows = {1: {"name": "Out", "likelihood": 0, "lockedUntil": None}, 2: {"name": "In", "likelihood": 4, "lockedUntil": None}}
    assert "In may rise" in price_timing_note({"out": 1, "in": 2}, rows)
    rows[2]["lockedUntil"] = "2026-11-22T00:00:00Z"
    assert price_timing_note({"out": 1, "in": 2}, rows) is None


def test_transfer_plan_keeps_every_week_legal(tmp_path, fake_client, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    plan = snapshot["solverPlan"]
    players = {player["id"]: player for player in sample["bootstrap-static/"]["elements"]}
    squad = list(snapshot["squad"])
    for week in plan["weeks"]:
        for move in week["moves"]:
            assert players[move["out"]]["element_type"] == players[move["in"]]["element_type"]
            squad[squad.index(move["out"])] = move["in"]
        assert week["bank"] >= 0
        assert not rules.check_squad([players[player_id] for player_id in squad], bank=week["bank"])
    assert plan["gain"] >= 0


def test_league_summary_finds_threats_and_differentials(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    league = snapshot["leagues"][0]
    assert league["name"] == "Family League" and league["size"] == 4 and league["rivalsWithPicks"] == 3
    squad = set(snapshot["squad"])
    assert all(line["playerId"] not in squad for line in league["threats"])
    assert all(line["share"] <= 0.25 for line in league["differentials"])
    assert all(str(line["playerId"]) in snapshot["players"] for line in league["threats"])
    rival = next(row for row in league["table"] if row["entry"] == 1001)
    assert "3xc" not in rival["chipsLeft"] and "bboost" in rival["chipsLeft"]
    holding = snapshot["chipPlan"]["rivals"][0]["holding"]
    assert holding["3xc"] == 1 and holding["bboost"] == 3


def test_rival_picks_are_cached_after_the_first_run(tmp_path, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    fake_http = FakeHttpClient(sample)
    client = FplClient(min_seconds_between_requests=0, http_client=fake_http)
    run(TEAM_ID, False, tmp_path, None, client=client)
    fake_http.requested.clear()
    run(TEAM_ID, False, tmp_path, None, client=client)
    assert not any(path.startswith("entry/1001/") for path in fake_http.requested)


def test_review_compares_the_captain_with_the_best_pick(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    review = snapshot["review"]
    assert review["gameweek"] == CURRENT_WEEK and review["average"] is not None
    team = review["team"]
    assert team["bestCaptain"]["points"] >= team["captain"]["points"]
    assert len(team["starters"]) == 11
    assert review["season"]["totals"]["weeks"] == CURRENT_WEEK


def test_chip_cards_carry_a_decision_risk_and_week_values(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    cards = {card["chip"]: card for card in snapshot["chipPlan"]["cards"]}
    triple = cards["3xc"]
    assert triple["decision"]["action"] in ("play", "save", "none")
    assert 0 <= triple["risk"]["haulChance"] <= 1
    assert [week["gameweek"] for week in triple["byWeek"]] == list(range(CURRENT_WEEK + 1, 20))
    assert 0 <= cards["bboost"]["risk"]["allBenchPlay"] <= 1
    assert "fixtureWarnings" in snapshot["chipPlan"]


def test_play_now_when_this_week_is_close_to_the_best():
    close = {"3xc": {13: ChipValue(9.5, ""), 16: ChipValue(10.0, "")}}
    assert best_chip_weeks(close, this_week=13) == {"3xc": 13}
    far_apart = {"3xc": {13: ChipValue(6.0, ""), 16: ChipValue(10.0, "")}}
    assert best_chip_weeks(far_apart, this_week=13) == {"3xc": 16}
    # Two chips both close to their best this week: only one can be played now.
    both = {"3xc": {13: ChipValue(9.5, ""), 16: ChipValue(10.0, "")}, "bboost": {13: ChipValue(9.5, ""), 15: ChipValue(10.0, "")}}
    assert list(best_chip_weeks(both, this_week=13).values()).count(13) == 1


def test_chip_planner_and_transfer_plan_always_agree(tmp_path, fake_client, sample, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("squadsense.strategy.SOLVER_CHIPS", ("bboost", "3xc", "freehit", "wildcard"))
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    plan = snapshot["solverPlan"]
    for week in plan["weeks"]:
        if week["chip"] in ("wildcard", "freehit"):
            assert week["hits"] == 0
        if week["chip"] == "freehit":
            assert len(week["freeHitSquad"]) == 15 and week["moves"] == []
    chips = [week["chip"] for week in plan["weeks"] if week["chip"]]
    assert len(chips) == len(set(chips))
    # The one rule: every chip the plan plays is "play" in that same week on the Chip Planner, and no other chip is.
    cards = {card["chip"]: card for card in snapshot["chipPlan"]["cards"] if card["status"] == "available"}
    played_on_cards = {chip: card["decision"]["week"] for chip, card in cards.items() if card["decision"]["action"] == "play"}
    assert played_on_cards == plan["chips"]
    assert snapshot["chipPlan"]["source"] == "plan"
    # Every week Free Hit could be played has a legal one-week squad the Planner can try.
    players = {player["id"]: player for player in sample["bootstrap-static/"]["elements"]}
    planned_weeks = {str(week["gameweek"]) for week in plan["weeks"]}
    assert plan["freeHitSquads"] and set(plan["freeHitSquads"]) <= planned_weeks
    for free_hit in plan["freeHitSquads"].values():
        assert len(free_hit) == 15 and not rules.check_squad([players[player_id] for player_id in free_hit], bank=0)
        assert all(str(player_id) in snapshot["players"] for player_id in free_hit)
    assert all("value" in move for week in plan["weeks"] for move in week["moves"])
    assert plan["normalTransfers"]["gain"] <= plan["gain"] + 1e-6


def test_keep_values_add_the_wildcard_margin_and_ignore_weeks_inside_the_window():
    from squadsense.strategy import keep_values
    values = {"3xc": {12: ChipValue(9.0, ""), 18: ChipValue(8.0, "")}, "wildcard": {12: ChipValue(20.0, "")}}
    keep = keep_values(values, window_end=16)
    assert keep["3xc"] == pytest.approx(0.9 * 8.0)
    assert keep["wildcard"] == pytest.approx(5.0)  # nothing after the window, just the safety margin


def test_chip_values_count_only_what_normal_transfers_leave():
    from squadsense.strategy import against_normal_transfers
    values = {"wildcard": {12: ChipValue(20.0, "x")}, "3xc": {12: ChipValue(7.0, "y")}}
    adjusted, share_left = against_normal_transfers(values, gap=20.0, normal_gain=8.0)
    assert share_left == pytest.approx(0.6)
    assert adjusted["wildcard"][12].gain == pytest.approx(12.0)
    assert adjusted["3xc"][12].gain == 7.0


ODDS_CSV = """Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5
E0,05/12/2026,15:00,Man City,Tottenham,3,1,1.40,5.00,7.50,1.45,2.80
E0,05/12/2026,17:30,Arsenal,Man United,,,2.10,3.40,3.60,1.90,1.95
"""


def test_odds_turn_into_expected_goals():
    from squadsense.odds import expected_goals_from_odds, fair_probabilities
    assert abs(sum(fair_probabilities([1.4, 5.0, 7.5])) - 1) < 1e-9
    home, away = expected_goals_from_odds([1.40, 5.00, 7.50, 1.45, 2.80])
    assert home > 2 > away  # a big favourite at home in a high-scoring match
    assert expected_goals_from_odds([None, 3.0, 3.0, 2.0, 2.0]) is None


def test_odds_rows_match_fpl_fixtures_by_club_and_date():
    from squadsense.odds import market_goals, parse_matches
    teams = [{"id": 1, "name": "Man City"}, {"id": 2, "name": "Spurs"}, {"id": 3, "name": "Arsenal"}, {"id": 4, "name": "Man Utd"}]
    fixtures = [
        {"event": 14, "team_h": 1, "team_a": 2, "kickoff_time": "2026-12-05T15:00:00Z"},
        {"event": 14, "team_h": 3, "team_a": 4, "kickoff_time": "2026-12-05T17:30:00Z"},
    ]
    goals = market_goals(parse_matches(ODDS_CSV), teams, fixtures, 14, 14)
    # football-data.co.uk writes "Tottenham" and "Man United"; FPL writes "Spurs" and "Man Utd".
    assert set(goals) == {(1, 2, True), (2, 1, False), (3, 4, True), (4, 3, False)}
    assert goals[(1, 2, True)] > goals[(2, 1, False)]


def test_fixture_model_blends_in_the_market():
    from squadsense import fixtures as fixtures_module
    from squadsense.fixtures import FixtureModel
    ratings = {1: {"attack": 1.0, "concede": 1.0}, 2: {"attack": 1.0, "concede": 1.0}}
    ours = FixtureModel(ratings).expected_goals(1, 2, True)
    blended = FixtureModel(ratings, {(1, 2, True): 3.0}).expected_goals(1, 2, True)
    assert blended == pytest.approx((1 - fixtures_module.MARKET_WEIGHT) * ours + fixtures_module.MARKET_WEIGHT * 3.0)


def test_elo_rewards_winners_and_welcomes_promoted_clubs():
    from squadsense.elo import ratings_before
    results = [
        {"date": "2025-08-16", "home": "A", "away": "B", "home_goals": 3, "away_goals": 0},
        {"date": "2025-08-23", "home": "C", "away": "A", "home_goals": 0, "away_goals": 1},
        {"date": "2026-08-15", "home": "A", "away": "D", "home_goals": 1, "away_goals": 1},
    ]
    ratings, latest = ratings_before(results, "2026-08-14")
    assert ratings["A"] > 1500 > ratings["B"]
    ratings, latest = ratings_before(results, "2026-08-20")
    assert latest == {"A", "D"}
    assert "D" in ratings


def test_goals_conceded_penalty_rounds_down_per_two_goals():
    from squadsense.model import expected_goals_conceded_penalty
    assert expected_goals_conceded_penalty(0.0) == 0
    # At 1.5 expected goals against, rounding down makes it about 0.5, not 0.75.
    assert 0.45 < expected_goals_conceded_penalty(1.5) < 0.6


def test_noise_is_bigger_for_players_whose_minutes_are_uncertain():
    import numpy
    from squadsense.model import PlayerRates
    from squadsense.strategy import noisy_expected_points
    nailed = PlayerRates(0.3, 0.1, 0.3, 0, 0, 1.0, 0.0, 5)
    rotation = PlayerRates(0.3, 0.1, 0.3, 0, 0, 0.3, 0.4, 5)
    xp = {1: {12: 5.0}, 2: {12: 5.0}}
    spread = {1: [], 2: []}
    rng = numpy.random.default_rng(1)
    for _ in range(300):
        noisy = noisy_expected_points(xp, {1: nailed, 2: rotation}, rng)
        for player in (1, 2):
            spread[player].append(noisy[player][12])
    assert numpy.std(spread[2]) > 3 * numpy.std(spread[1])


def test_moves_carry_how_often_they_come_back(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("squadsense.strategy.SENSITIVITY_RUNS", 3)
    snapshot = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    plan = snapshot["solverPlan"]
    assert plan["sensitivity"]["runs"] == 3
    for week in plan["weeks"]:
        for move in week["moves"]:
            assert 0 <= move["sameWeekShare"] <= move["anyWeekShare"] <= 1


def test_likely_price_moves_follow_fpl_projections():
    from squadsense.price_watch import likely_price_moves
    bootstrap = {"elements": [
        {"id": 1, "price_change_projections": [{"offset": 0, "likelihood": 4, "projected_percent": "120"}]},
        {"id": 2, "price_change_projections": [{"offset": 0, "likelihood": -5, "projected_percent": "-130"}]},
        {"id": 3, "price_change_projections": [{"offset": 0, "likelihood": 2, "projected_percent": "40"}]},
        {"id": 4, "price_change_projections": [{"offset": 0, "likelihood": 5, "projected_percent": "140"}], "price_change_locked_until": "2026-11-22"},
    ]}
    assert likely_price_moves(bootstrap) == {1: 1, 2: -1}


def test_price_notes_say_buy_now_before_a_rise():
    from squadsense.strategy import add_price_notes
    weeks = [{"moves": [{"out": 5, "in": 1}]}, {"moves": [{"out": 2, "in": 6}]}]
    add_price_notes(weeks, {1: 1, 2: -1})
    assert "buy now" in weeks[0]["moves"][0]["priceNote"]
    assert "sells for less" in weeks[1]["moves"][0]["priceNote"]


def feed_summary(**overrides):
    summary = {
        "gameweek": 12, "squad": [1, 2], "captain": 1,
        "players": {"1": {"name": "Haaland", "windowXp": 30.0, "price": 150, "news": ""}, "2": {"name": "Saka", "windowXp": 25.0, "price": 100, "news": ""}},
        "firstWeekMoves": [[2, 3]], "chips": {"3xc": "save 19"},
    }
    summary.update(overrides)
    return summary


def test_feed_describes_what_moved():
    from squadsense.changes import plan_changes, player_changes
    before = feed_summary()
    after = feed_summary(
        players={"1": {"name": "Haaland", "windowXp": 28.5, "price": 151, "news": "Knock - 75% chance of playing"},
                 "2": {"name": "Saka", "windowXp": 25.4, "price": 100, "news": ""}},
        firstWeekMoves=[], chips={"3xc": "play 13"},
    )
    lines = player_changes(before, after) + plan_changes(before, after)
    assert "Haaland: Knock - 75% chance of playing" in lines
    assert any("Haaland's five-week xP 30.0 → 28.5" in line for line in lines)
    assert any("£15.0m → £15.1m" in line for line in lines)
    assert not any(line.startswith("Saka") for line in lines)  # +0.4 is too small to report
    assert "Triple Captain: now play in GW13 (was save for GW19)" in lines
    assert any(line.startswith("This week's plan is now no transfer") for line in lines)


def test_sync_keeps_a_feed_between_runs(tmp_path, fake_client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    first = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    assert first["changes"] == []  # nothing to compare with yet
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    saved = storage.load_raw(f"changes/{TEAM_ID}")
    saved["summary"]["captain"] = -1  # pretend last run picked someone else
    storage.save_raw(f"changes/{TEAM_ID}", saved)
    second = run(TEAM_ID, False, tmp_path, None, client=fake_client)
    assert any("Captain pick is now" in line for line in second["changes"][0]["changes"])


def test_full_refresh_only_downloads_clubs_that_just_played():
    from datetime import datetime, timezone
    from squadsense.sync import clubs_that_played_recently, histories_to_fetch
    now = datetime(2026, 11, 22, 1, 37, tzinfo=timezone.utc)
    fixtures = [
        {"started": True, "kickoff_time": "2026-11-21T15:00:00Z", "team_h": 1, "team_a": 2},  # yesterday
        {"started": True, "kickoff_time": "2026-11-15T15:00:00Z", "team_h": 3, "team_a": 4},  # last week
        {"started": False, "kickoff_time": "2026-11-28T15:00:00Z", "team_h": 5, "team_a": 6},  # not played yet
    ]
    assert clubs_that_played_recently(fixtures, now) == {1, 2}
    bootstrap = {"elements": [{"id": 10, "team": 1}, {"id": 11, "team": 3}, {"id": 12, "team": 5}]}
    cached = {10: [], 11: [], 12: []}
    assert histories_to_fetch(bootstrap, cached, cached, [], full_refresh=False, fixtures=fixtures) == []
    assert 11 not in histories_to_fetch(bootstrap, cached, cached, [], full_refresh=True, fixtures=fixtures)


def alert_snapshot(**overrides):
    snapshot = {
        "gameweek": 12, "deadline": "2026-11-27T18:30:00Z", "squad": [1, 2],
        "players": {"1": {"name": "Haaland", "news": "", "yellowCards": 4}, "2": {"name": "Saka", "news": "Knock - 75% chance of playing", "yellowCards": 1},
                    "3": {"name": "Palmer", "news": ""}},
        "captainOptions": [{"playerId": 1}], "priceWatch": {"atRisk": [2]},
        "flags": [{"playerId": 1, "kind": "suspension", "message": "On 4 yellows. One more before match 19 means a ban."}],
        "solverPlan": {"weeks": [{"moves": [{"out": 2, "in": 3}], "chip": None}]}, "changes": [],
    }
    snapshot.update(overrides)
    return snapshot


class FakeResend:
    """Stands in for httpx.Client: records every email instead of sending it."""

    def __init__(self):
        self.sent = []

    def post(self, url, headers, json):
        self.sent.append(json)
        return type("Response", (), {"status_code": 200, "text": "ok"})()


def test_plan_brief_once_inside_26_hours(tmp_path):
    from datetime import datetime, timezone
    from squadsense.alerts import plan_brief_alert
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    snapshot = brief_snapshot()
    assert plan_brief_alert(snapshot, datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc), storage) == []  # 30 hours out
    alert = plan_brief_alert(snapshot, datetime(2026, 11, 26, 22, 30, tzinfo=timezone.utc), storage)[0]  # 20 hours out
    assert alert.title == "Plan for GW12" and alert.keys == ["brief-12"]
    assert any(row.value == "Saka → Palmer" for row in alert.rows)
    alert.after_send()
    assert storage.load_raw("brief/0/12")["captain"] == 1


def test_final_call_lists_changes_since_the_brief(tmp_path):
    from datetime import datetime, timezone
    from squadsense.alerts import final_call_alert, plan_brief_alert
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    plan_brief_alert(brief_snapshot(), datetime(2026, 11, 26, 22, 30, tzinfo=timezone.utc), storage)[0].after_send()
    later = brief_snapshot(captainOptions=[{"playerId": 3, "xp": 7.5}, {"playerId": 1, "xp": 7.0}])
    later["solverPlan"]["weeks"][0]["captain"] = 3
    two_hours_before = datetime(2026, 11, 27, 16, 30, tzinfo=timezone.utc)
    alert = final_call_alert(later, two_hours_before, storage)[0]
    assert alert.keys == ["final-12"] and "Fri 27 Nov, 18:30 UK" in alert.title
    assert alert.note == "Changed since the plan brief: Captain was Haaland."
    assert final_call_alert(later, datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc), storage) == []


def test_final_call_without_a_saved_brief_has_no_note(tmp_path):
    from datetime import datetime, timezone
    from squadsense.alerts import final_call_alert
    from squadsense.storage import FileStorage
    alert = final_call_alert(brief_snapshot(solverPlan=None), datetime(2026, 11, 27, 16, 30, tzinfo=timezone.utc), FileStorage(tmp_path))[0]
    assert alert.note is None


def test_price_alert_only_for_players_the_plan_sells():
    from datetime import datetime, timezone
    from squadsense.alerts import price_drop_alert
    night = datetime(2026, 11, 27, 22, 15, tzinfo=timezone.utc)
    assert price_drop_alert(alert_snapshot(), night)[0].title == "Price drop likely tonight"  # Saka is sold
    kept = alert_snapshot(solverPlan={"weeks": [{"moves": [], "chip": None, "captain": 1}]})
    assert price_drop_alert(kept, night) == []


def test_alerts_send_once_and_skip_old_news_on_the_first_run(tmp_path):
    from datetime import datetime, timezone
    from squadsense.alerts import Channels, run_alerts
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    channels = Channels(resend_key="test", email_to="me@example.com")
    resend = FakeResend()
    now = datetime(2026, 11, 27, 22, 15, tzinfo=timezone.utc)
    first = run_alerts(storage, alert_snapshot(), channels, resend, now)
    # First run: the price drop goes out, but existing injury and ban news is only recorded.
    assert first == ["Price drop likely tonight"]
    assert run_alerts(storage, alert_snapshot(), channels, resend, now) == []  # nothing twice
    newer = alert_snapshot(players={**alert_snapshot()["players"], "1": {"name": "Haaland", "news": "Hamstring - 50% chance of playing", "yellowCards": 4}})
    assert run_alerts(storage, newer, channels, resend, now) == ["Haaland: injury news"]
    assert len(resend.sent) == 2 and resend.sent[0]["to"] == ["me@example.com"]


def test_test_alert_sends_email_and_records_nothing(tmp_path):
    from squadsense.alerts import Channels, send_test_alert
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    resend = FakeResend()
    results = send_test_alert(storage, Channels(resend_key="test", email_to="me@example.com"), resend)
    assert results == {"email": True, "push": None}
    assert resend.sent[0]["subject"] == "SquadSense: Test alert"
    assert not storage.alert_was_sent("alerts-primed")  # a test never counts as the first real run


def test_no_alert_settings_means_nothing_is_sent(tmp_path):
    from datetime import datetime, timezone
    from squadsense.alerts import Channels, run_alerts
    from squadsense.storage import FileStorage
    now = datetime(2026, 11, 27, 22, 15, tzinfo=timezone.utc)
    assert run_alerts(FileStorage(tmp_path), alert_snapshot(), Channels(), FakeResend(), now) == []


class FakeLeagueClient:
    """Answers league table pages from made-up leagues, and records each page asked for.

    `sizes` maps league id to its number of teams. Teams are numbered so
    team 5000 + rank sits at that rank, and every team has empty picks.
    """

    def __init__(self, sizes):
        self.sizes = sizes
        self.pages_asked = []

    def league_standings(self, league_id, page=1):
        self.pages_asked.append((league_id, page))
        size = self.sizes[league_id]
        ranks = range((page - 1) * 50 + 1, min(page * 50, size) + 1)
        rows = [{"entry": 5000 + rank, "entry_name": f"Team {rank}", "player_name": f"Manager {rank}", "rank": rank,
                 "last_rank": rank, "total": 1000 - rank, "event_total": 50} for rank in ranks]
        return {"standings": {"has_next": page * 50 < size, "page": page, "results": rows}}

    def entry_picks(self, team_id, gameweek):
        return {"picks": [], "active_chip": None}

    def entry_history(self, team_id):
        return {"chips": []}


def league_entry(*leagues):
    """A team entry listing the given (id, size, my rank) private leagues."""
    return {"id": TEAM_ID, "leagues": {"classic": [
        {"id": league_id, "name": f"League {league_id}", "league_type": "x", "rank_count": size, "entry_rank": rank, "entry_last_rank": rank}
        for league_id, size, rank in leagues
    ]}}


def test_every_private_league_is_listed_and_big_ones_are_table_only(tmp_path):
    from squadsense import leagues
    from squadsense.storage import FileStorage
    client = FakeLeagueClient({1: 10, 2: 80, 3: 500})
    fetched = leagues.fetch_leagues(client, FileStorage(tmp_path), league_entry((3, 500, 230), (1, 10, 4), (2, 80, 60)), 12, today="2026-11-22")
    assert [league["info"]["id"] for league in fetched] == [1, 2, 3]  # smallest first
    assert [league["kind"] for league in fetched] == ["full", "full", "table"]
    assert len(fetched[1]["standings"]) == 80  # both 50-team pages of a full league
    big = fetched[2]
    assert big["picks"] == {} and [row["rank"] for row in big["standings"]][:1] == [1]
    assert 230 in [row["rank"] for row in big["standings"]]  # the page around you
    assert (3, 1) in client.pages_asked and (3, 5) in client.pages_asked


def test_big_league_tables_are_reused_for_the_rest_of_the_day(tmp_path):
    from squadsense import leagues
    from squadsense.storage import FileStorage
    storage, entry = FileStorage(tmp_path), league_entry((3, 500, 230))
    leagues.fetch_leagues(FakeLeagueClient({3: 500}), storage, entry, 12, today="2026-11-22")
    same_day = FakeLeagueClient({3: 500})
    leagues.fetch_leagues(same_day, storage, entry, 12, today="2026-11-22")
    next_day = FakeLeagueClient({3: 500})
    leagues.fetch_leagues(next_day, storage, entry, 12, today="2026-11-23")
    assert same_day.pages_asked == [] and len(next_day.pages_asked) == 2


def test_table_only_leagues_have_no_rival_lists_or_chip_rows(tmp_path):
    from squadsense import leagues
    from squadsense.storage import FileStorage
    fetched = leagues.fetch_leagues(FakeLeagueClient({1: 10, 3: 500}), FileStorage(tmp_path), league_entry((1, 10, 4), (3, 500, 230)), 12, today="2026-11-22")
    summaries = leagues.build_leagues(fetched, TEAM_ID, [], {}, 13, (1, 19))
    big = summaries[1]
    assert big["kind"] == "table" and big["size"] == 500 and big["myRank"] == 230
    assert big["threats"] == [] and big["rivalsWithPicks"] == 0
    assert [summary["id"] for summary in leagues.rival_chip_summary(summaries)] == [1]


def test_query_strings_keep_the_trailing_slash_on_the_path():
    fake_http = FakeHttpClient({"leagues-classic/7/standings/?page_standings=2": {"standings": {"results": []}}})
    FplClient(min_seconds_between_requests=0, http_client=fake_http).league_standings(7, 2)
    assert fake_http.requested == ["leagues-classic/7/standings/?page_standings=2"]


def test_season_review_adds_up_points_bench_hits_and_captain_choices():
    from squadsense.review import season_review
    bootstrap = {"events": [
        {"id": week, "finished": True, "data_checked": True, "average_entry_score": 50} for week in (1, 2)
    ] + [{"id": 3, "finished": False, "data_checked": False}]}
    histories = {10: [{"round": 1, "total_points": 2}, {"round": 2, "total_points": 12}],
                 20: [{"round": 1, "total_points": 9}, {"round": 2, "total_points": 3}]}
    rows = {week: {"event": week, "points": points, "event_transfers_cost": cost, "overall_rank": rank, "points_on_bench": bench}
            for week, points, cost, rank, bench in [(1, 60, 4, 900, 3), (2, 45, 0, 950, 7), (3, 0, 0, 950, 0)]}
    captain_on = lambda player_id: {"picks": [
        {"element": 10, "multiplier": 2 if player_id == 10 else 1, "is_captain": player_id == 10},
        {"element": 20, "multiplier": 2 if player_id == 20 else 1, "is_captain": player_id == 20},
    ]}
    season = season_review(bootstrap, histories, rows, {1: captain_on(10), 2: captain_on(10)}, {1: {"expectedPoints": 52.5}})
    assert [week["gameweek"] for week in season["weeks"]] == [1, 2]  # week 3 isn't finished
    first, second = season["weeks"]
    assert first["points"] == 56 and first["captainLost"] == 7  # captained 2 points, 9 was there
    assert second["captainLost"] == 0 and second["predicted"] is None
    totals = season["totals"]
    assert totals["points"] == 101 and totals["benchPoints"] == 10 and totals["transferCost"] == 4
    assert totals["aboveAverage"] == 1 and totals["captainRight"] == 1 and totals["captainLost"] == 7
    assert totals["forecastWeeks"] == 1 and totals["forecastPredicted"] == 52.5 and totals["forecastActual"] == 56


def test_reused_plans_get_tonights_price_notes():
    from squadsense.strategy import refresh_price_notes
    rising = {"id": 7, "price_change_projections": [{"offset": 0, "likelihood": 5}], "price_change_locked_until": None}
    steady = {"id": 8, "price_change_projections": [{"offset": 0, "likelihood": 0}], "price_change_locked_until": None}
    plan = {
        "weeks": [{"moves": [{"out": 8, "in": 7, "priceNote": None}]}, {"moves": [{"out": 8, "in": 7, "priceNote": None}]}],
        "normalTransfers": {"weeks": [{"moves": [{"out": 8, "in": 7, "priceNote": "stale note"}]}]},
    }
    refresh_price_notes(plan, {"elements": [rising, steady]})
    assert plan["weeks"][0]["moves"][0]["priceNote"] == "buy now: likely to rise £0.1m tonight"
    assert plan["weeks"][1]["moves"][0]["priceNote"] == "priced £0.1m higher after tonight's likely rise"
    assert plan["normalTransfers"]["weeks"][0]["moves"][0]["priceNote"] == "buy now: likely to rise £0.1m tonight"
    refresh_price_notes(plan, {"elements": [dict(rising, price_change_projections=[{"offset": 0, "likelihood": 0}]), steady]})
    assert plan["weeks"][0]["moves"][0]["priceNote"] is None  # no longer likely, so the old note goes
    refresh_price_notes(None, {"elements": []})  # an estimate-only result has no plan


def shared_rule_cases():
    """The cases in shared/rule-cases.json, which web/tests/rules.test.mts checks too."""
    import json
    from pathlib import Path
    return json.loads((Path(__file__).resolve().parents[2] / "shared" / "rule-cases.json").read_text())


def test_shared_rule_cases_match_the_python_rules():
    cases = shared_rule_cases()
    for case in cases["hitPoints"]:
        assert rules.hit_points(case["transfersMade"], case["freeTransfers"], case["chip"]) == case["expected"], case["why"]
    for case in cases["nextFreeTransfers"]:
        assert rules.next_free_transfers(case["freeTransfers"], case["transfersMade"], case["chip"]) == case["expected"], case["why"]
    for case in cases["clubsOverLimit"]:
        assert rules.clubs_over_limit(case["clubs"]) == case["expected"], case["why"]
    codes = {name: code for code, name in rules.POSITION_NAMES.items()}
    for case in cases["formations"]:
        starters = [{"element_type": codes[position]} for position in case["positions"]]
        assert rules.is_valid_formation(starters) == case["expected"], case["why"]


def test_price_predictions_are_saved_per_uk_day():
    from datetime import datetime, timezone
    from squadsense.price_watch import predictions_record
    bootstrap = {"elements": [
        {"id": 1, "now_cost": 55, "price_change_projections": [{"offset": 0, "likelihood": 4}], "price_change_locked_until": None},
        {"id": 2, "now_cost": 80, "price_change_projections": [{"offset": 0, "likelihood": -5}], "price_change_locked_until": "2026-11-25"},
    ]}
    summer_night = predictions_record(bootstrap, datetime(2026, 7, 10, 23, 30, tzinfo=timezone.utc))
    assert summer_night["day"] == "2026-07-11"  # 00:30 in the UK, after that night's change
    winter_night = predictions_record(bootstrap, datetime(2026, 11, 22, 23, 45, tzinfo=timezone.utc))
    assert winter_night["day"] == "2026-11-22"  # still before 00:00 UK
    assert winter_night["players"] == {"1": [55, 4], "2": [80, 0]}  # a locked price counts as no change


def test_price_audit_scores_each_band_against_the_next_day(tmp_path):
    from squadsense.price_audit import PREFIX, band_table, outcomes, report
    from squadsense.storage import FileStorage
    storage = FileStorage(tmp_path)
    storage.save_raw(f"{PREFIX}2026-11-20", {"day": "2026-11-20", "players": {"1": [55, 5], "2": [80, -4], "3": [45, 0], "4": [60, 3]}})
    storage.save_raw(f"{PREFIX}2026-11-21", {"day": "2026-11-21", "players": {"1": [56, 0], "2": [79, 0], "3": [46, 0], "4": [60, 0]}})
    storage.save_raw(f"{PREFIX}2026-11-23", {"day": "2026-11-23", "players": {"1": [56, 5]}})  # no 24th yet, so skipped
    records = storage.load_raws(PREFIX)
    assert [record["day"] for record in records] == ["2026-11-20", "2026-11-21", "2026-11-23"]
    table = band_table(outcomes(records))
    assert table[5]["rose"] == 1 and table[-4]["fell"] == 1 and table[3]["unchanged"] == 1
    assert table[0]["rose"] == 1  # player 3 rose with no warning
    text = report(records)
    assert "1 night(s) checked" in text and "Changes FPL rated 0 (no change): 1" in text
    assert "Not enough data yet" in report(records[:1])


def test_tied_teams_keep_a_gap_free_position():
    from squadsense.leagues import table_rows
    standings = [
        {"entry": entry, "entry_name": f"T{entry}", "player_name": "M", "rank": rank, "rank_sort": sort, "last_rank": rank, "total": 100, "event_total": 50}
        for entry, rank, sort in [(1, 11, 11), (2, 11, 12), (3, 13, 13)]
    ]
    rows = table_rows(standings, {}, {}, (1, 19))
    assert [row["rank"] for row in rows] == [11, 11, 13]
    assert [row["position"] for row in rows] == [11, 12, 13]  # no gap, so no "..." row on the page


def brief_snapshot(**overrides):
    """A snapshot with a full first-week plan and chip decisions, for the brief tests."""
    week = {"moves": [{"out": 2, "in": 3, "sameWeekShare": 1.0}, {"out": 4, "in": 5, "sameWeekShare": 0.4},
                      {"out": 6, "in": 7, "sameWeekShare": 1.0, "priceNote": "buy now: likely to rise £0.1m tonight"}],
            "captain": 1, "chip": None, "hits": 0}
    snapshot = alert_snapshot(
        players={str(i): {"name": name, "news": ""} for i, name in enumerate(["", "Haaland", "Saka", "Palmer", "Raya", "Pickford", "Isak", "Wood"]) if i},
        captainOptions=[{"playerId": 1, "xp": 7.0}, {"playerId": 3, "xp": 6.8}],
        solverPlan={"weeks": [week]},
        chipPlan={"cards": [
            {"chip": "wildcard", "label": "Wildcard", "status": "available", "decision": {"action": "play", "week": 12, "closeCall": False}},
            {"chip": "3xc", "label": "Triple Captain", "status": "available", "decision": {"action": "save", "week": 17, "closeCall": True}},
            {"chip": "bboost", "label": "Bench Boost", "status": "used", "decision": None},
        ]},
    )
    snapshot.update(overrides)
    return snapshot


def test_plan_rows_mark_firm_and_close_calls():
    from squadsense.briefs import plan_rows
    rows = {(row.label, row.value): row.tag for row in plan_rows(brief_snapshot())}
    assert rows[("Transfer", "Saka → Palmer")] == "FIRM"
    assert rows[("Transfer", "Raya → Pickford")] == "CLOSE CALL"
    assert rows[("Transfer", "Isak → Wood")] == "MAKE NOW"
    assert rows[("Captain", "Haaland (vice Palmer)")] == "CLOSE CALL"  # Palmer is only 0.2 xP behind
    assert rows[("Chip", "Play Wildcard this week. It can't be undone.")] == "FIRM"
    assert rows[("Later", "Triple Captain in GW17")] == "CLOSE CALL"


def test_plan_rows_without_a_solver_plan():
    from squadsense.briefs import plan_rows
    labels = [row.label for row in plan_rows(brief_snapshot(solverPlan=None))]
    assert "Transfer" not in labels and "Captain" in labels and "Chip" in labels


def test_changes_since_names_the_old_captain():
    from squadsense.briefs import brief_summary, changes_since
    saved = brief_summary(brief_snapshot())
    saved["captain"] = 3
    assert changes_since(saved, brief_snapshot()) == ["Captain was Palmer"]
    assert changes_since(None, brief_snapshot()) == []


def test_uk_time_reads_like_a_fixture_list():
    from squadsense.briefs import uk_time
    assert uk_time("2026-11-27T18:30:00Z") == "Fri 27 Nov, 18:30 UK"
    assert uk_time("2027-04-02T17:30:00Z") == "Fri 2 Apr, 18:30 UK"  # British Summer Time


def test_email_escapes_names_and_links_the_page():
    from datetime import datetime, timezone
    from squadsense.alerts import Alert
    from squadsense.briefs import Row
    from squadsense.email_template import render_email
    alert = Alert(["k"], "Plan for GW12", "One line.", "/plan", rows=[Row("Transfer", "Smith & <Rowe> → Saka", "FIRM")], intro="Deadline soon.")
    html, text = render_email(alert, "https://x.test", datetime(2026, 11, 26, 22, 17, tzinfo=timezone.utc))
    assert "Smith &amp; &lt;Rowe&gt;" in html and "<Rowe>" not in html
    assert 'href="https://x.test/plan"' in html
    assert "Transfer: Smith & <Rowe> → Saka [FIRM]" in text and "Deadline soon." in text
    assert "after the 22:17 UK sync" in html and "after the 22:17 UK sync" in text


def test_email_without_site_url_links_the_path():
    from datetime import datetime, timezone
    from squadsense.alerts import Alert
    from squadsense.email_template import render_email
    html, text = render_email(Alert(["k"], "Saka: injury news", "Knock - 75% chance of playing", "/"), "", datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc))
    assert 'href="/"' in html and "Knock - 75% chance of playing" in html and "Knock" in text


def test_alert_email_sends_html_text_and_reply_to(tmp_path):
    from squadsense.alerts import Channels, send_test_alert
    from squadsense.storage import FileStorage
    resend = FakeResend()
    send_test_alert(FileStorage(tmp_path), Channels(resend_key="test", email_to="me@example.com"), resend)
    email = resend.sent[0]
    assert email["html"].startswith("<!doctype html>") and "Alerts are working" in email["text"]
    assert email["reply_to"] == "me@example.com"
