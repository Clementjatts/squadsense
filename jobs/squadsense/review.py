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
"""

TOP_PLAYERS_SHOWN = 5


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


def team_week(picks, history_row, previous_row, points, forecast):
    """Your own week: score, rank movement, captain choice and xP against points."""
    starters = [pick["element"] for pick in picks["picks"] if pick["multiplier"] > 0]
    captain = next(pick["element"] for pick in picks["picks"] if pick["is_captain"])
    best_captain = max(starters, key=lambda player_id: points.get(player_id, 0))
    predicted = (forecast or {}).get("xp", {})
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
        "starters": [
            {"playerId": player_id, "points": points.get(player_id, 0), "xp": predicted.get(str(player_id))}
            for player_id in starters
        ],
    }


def build_review(bootstrap, histories, entry_history, picks, forecast):
    """The review for the last finished gameweek, or None before any has finished.

    `picks` is your team's picks for that week (None if the team hadn't
    started), `entry_history` is entry/{id}/history/ (None for the same
    reason) and `forecast` is what save_forecast stored before it.
    """
    event = last_finished_week(bootstrap)
    if event is None:
        return None
    gameweek = event["id"]
    points = week_points(histories, gameweek)
    review = {"gameweek": gameweek, **league_wide(event, points), "team": None}

    rows = {row["event"]: row for row in (entry_history or {}).get("current", [])}
    if picks and gameweek in rows:
        review["team"] = team_week(picks, rows[gameweek], rows.get(gameweek - 1), points, forecast)
    return review


def players_mentioned(review):
    """Every player id the review refers to, so the snapshot can include them."""
    if not review:
        return set()
    ids = {line["playerId"] for line in review["topPlayers"]}
    if review["mostCaptained"]:
        ids.add(review["mostCaptained"]["playerId"])
    if review["team"]:
        ids.update(line["playerId"] for line in review["team"]["starters"])
    return ids
