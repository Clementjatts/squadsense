"""The gameweek review: how last week went, and what the model got right.

Every sync saves a small "forecast" for the coming gameweek: the lineup,
the captain and each player's xP. Once that gameweek is over, the review
puts the forecast next to what happened:

- your points, overall rank and points left on the bench,
- the week's average and highest scores, and the most captained player,
- your captain's points against the best captain you could have picked,
- each starter's xP against his real points.

Teams that hadn't started yet (like a team created mid-season) get the
league-wide part only.

The season view lists every finished week since your team started: points
against the average, overall rank, bench points, the captain points lost
to a worse pick, and the forecast total where one was saved.
"""

TOP_PLAYERS_SHOWN = 8  # fills the Across FPL card beside "Expected vs scored"


def forecast_name(team_id, gameweek):
    return f"forecast/{team_id}/{gameweek}"


def save_forecast(storage, team_id, gameweek, lineup, squad_ids, expected_points):
    """Stores this run's plan for `gameweek`, overwriting earlier runs until the deadline."""
    storage.save_raw(forecast_name(team_id, gameweek), {
        "gameweek": gameweek,
        "starters": lineup["starters"],
        "captain": lineup["captain"],
        "expectedPoints": lineup["expected_points"],
        "xp": {str(player_id): expected_points[player_id][gameweek] for player_id in squad_ids},
    })


def last_finished_week(bootstrap):
    """The latest gameweek whose points are final, or None before the season's first."""
    finished = [event for event in bootstrap["events"] if event["finished"] and event["data_checked"]]
    return finished[-1] if finished else None


def week_points(histories, gameweek):
    """{player_id: points} for one gameweek, adding up both matches in a double."""
    points = {}
    for player_id, rows in histories.items():
        week_rows = [row for row in rows if row["round"] == gameweek]
        if week_rows:
            points[player_id] = sum(row["total_points"] for row in week_rows)
    return points


def live_week_points(live):
    """{player_id: points} for every player, from FPL's event/{gw}/live/ answer.

    Once a week is final these are FPL's own totals, doubles included, for
    all players. Saved histories only cover players refreshed since the
    week, so they can miss the week's real top scorers.
    """
    return {element["id"]: element["stats"]["total_points"] for element in live["elements"]}


def league_wide(event, points):
    """Average, highest, most captained and the week's best players."""
    top = sorted(points.items(), key=lambda item: item[1], reverse=True)[:TOP_PLAYERS_SHOWN]
    most_captained = event.get("most_captained")
    return {
        "average": event.get("average_entry_score"),
        "highest": event.get("highest_score"),
        "mostCaptained": {"playerId": most_captained, "points": points.get(most_captained, 0)} if most_captained else None,
        "topPlayers": [{"playerId": player_id, "points": score} for player_id, score in top],
    }


STARTING_POSITIONS = 11  # FPL lists the starting eleven in positions 1 to 11, the bench in 12 to 15


def lineup_split(picks):
    """(starting eleven, bench in order) by FPL's positions.

    Multipliers can't be used for this: in a Bench Boost week the bench has
    a multiplier too.
    """
    ordered = sorted(picks["picks"], key=lambda pick: pick["position"])
    return ([pick["element"] for pick in ordered if pick["position"] <= STARTING_POSITIONS],
            [pick["element"] for pick in ordered if pick["position"] > STARTING_POSITIONS])


def captain_choice(picks, points):
    """Your captain, the best captain your eleven offered, and the captain's multiplier (2, or 3 with Triple Captain)."""
    starters, _ = lineup_split(picks)
    captain_pick = next(pick for pick in picks["picks"] if pick["is_captain"])
    best_captain = max(starters, key=lambda player_id: points.get(player_id, 0))
    return captain_pick["element"], best_captain, captain_pick["multiplier"]


def team_week(picks, history_row, previous_row, points, forecast):
    """Your own week: score, rank movement, captain choice and xP against points, starters and bench apart."""
    starters, bench = lineup_split(picks)
    captain, best_captain, _ = captain_choice(picks, points)
    predicted = (forecast or {}).get("xp", {})
    vice = next((pick["element"] for pick in picks["picks"] if pick["is_vice_captain"]), None)

    def line(player_id):
        return {"playerId": player_id, "points": points.get(player_id, 0), "xp": predicted.get(str(player_id))}

    return {
        "points": history_row["points"],
        "transferCost": history_row["event_transfers_cost"],
        "benchPoints": history_row["points_on_bench"],
        "overallRank": history_row["overall_rank"],
        "previousRank": previous_row["overall_rank"] if previous_row else None,
        "chip": picks.get("active_chip"),
        "captain": {"playerId": captain, "points": points.get(captain, 0)},
        "bestCaptain": {"playerId": best_captain, "points": points.get(best_captain, 0)},
        "predictedTotal": forecast["expectedPoints"] if forecast else None,
        "viceCaptain": vice,
        "starters": [line(player_id) for player_id in starters],
        "bench": [line(player_id) for player_id in bench],
    }


def build_review(bootstrap, histories, entry_history, picks, forecast, picks_by_week=None, forecasts_by_week=None, live_points=None):
    """The review for the last finished gameweek, or None before any has finished.

    `picks` is your team's picks for that week (None if the team hadn't
    started), `entry_history` is entry/{id}/history/ (None for the same
    reason) and `forecast` is what save_forecast stored before it.
    `picks_by_week` and `forecasts_by_week` cover every finished week since
    your team started, for the season view. `live_points` is FPL's final
    points for the reviewed week (live_week_points); without it the saved
    histories are used.
    """
    event = last_finished_week(bootstrap)
    if event is None:
        return None
    gameweek = event["id"]
    points = live_points if live_points is not None else week_points(histories, gameweek)
    review = {"gameweek": gameweek, **league_wide(event, points), "team": None, "season": None}

    rows = {row["event"]: row for row in (entry_history or {}).get("current", [])}
    if picks and gameweek in rows:
        review["team"] = team_week(picks, rows[gameweek], rows.get(gameweek - 1), points, forecast)
    if rows:
        review["season"] = season_review(bootstrap, histories, rows, picks_by_week or {}, forecasts_by_week or {})
    return review


def season_review(bootstrap, histories, history_rows, picks_by_week, forecasts_by_week):
    """Every finished week since your team started, plus season totals.

    Each week has your points (after hits), overall rank, bench points, the
    FPL average and, where known, the forecast total and the captain points
    you gained or lost against the best captain in your eleven.
    """
    finished = {event["id"]: event for event in bootstrap["events"] if event["finished"] and event["data_checked"]}
    weeks = [season_week(row, finished[row["event"]], histories, picks_by_week.get(row["event"]), forecasts_by_week.get(row["event"]))
             for row in sorted(history_rows.values(), key=lambda row: row["event"]) if row["event"] in finished]
    return {"weeks": weeks, "totals": season_totals(weeks)}


def season_week(history_row, event, histories, picks, forecast):
    """One row of the season table."""
    week = {
        "gameweek": history_row["event"],
        "points": history_row["points"] - history_row["event_transfers_cost"],
        "average": event.get("average_entry_score"),
        "overallRank": history_row["overall_rank"],
        "benchPoints": history_row["points_on_bench"],
        "transferCost": history_row["event_transfers_cost"],
        "predicted": forecast["expectedPoints"] if forecast else None,
        "captainLost": None,
    }
    if picks:
        points = week_points(histories, history_row["event"])
        captain, best_captain, multiplier = captain_choice(picks, points)
        # The captain's extra points are (multiplier - 1) times his score, so a
        # wrong pick costs that many times the gap to the best one.
        week["captainLost"] = (points.get(best_captain, 0) - points.get(captain, 0)) * (multiplier - 1)
    return week


def season_totals(weeks):
    """Season sums: points, bench points, hits, weeks above average and the captain record."""
    captain_weeks = [week for week in weeks if week["captainLost"] is not None]
    forecast_weeks = [week for week in weeks if week["predicted"] is not None]
    return {
        "weeks": len(weeks),
        "points": sum(week["points"] for week in weeks),
        "benchPoints": sum(week["benchPoints"] for week in weeks),
        "transferCost": sum(week["transferCost"] for week in weeks),
        "aboveAverage": sum(1 for week in weeks if week["average"] is not None and week["points"] > week["average"]),
        "captainWeeks": len(captain_weeks),
        "captainRight": sum(1 for week in captain_weeks if week["captainLost"] == 0),
        "captainLost": sum(week["captainLost"] for week in captain_weeks),
        "forecastWeeks": len(forecast_weeks),
        "forecastPredicted": round(sum(week["predicted"] for week in forecast_weeks), 1),
        "forecastActual": sum(week["points"] for week in forecast_weeks),
    }


def players_mentioned(review):
    """Every player id the review refers to, so the snapshot can include them."""
    if not review:
        return set()
    ids = {line["playerId"] for line in review["topPlayers"]}
    if review["mostCaptained"]:
        ids.add(review["mostCaptained"]["playerId"])
    if review["team"]:
        ids.update(line["playerId"] for line in review["team"]["starters"] + review["team"].get("bench", []))
    return ids
