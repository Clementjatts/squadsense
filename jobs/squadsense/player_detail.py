"""Data for the player detail panel, one entry per player.

The website doesn't load this with every page. It's stored in the
snapshot under `playerDetails`, and the panel asks for one player at a
time, which keeps pages light.
"""

RECENT_GAMEWEEKS = 6
NEXT_FIXTURES = 6
RECENT_MINUTES_MATCHES = 6


def recent_gameweeks(history_rows, count=RECENT_GAMEWEEKS):
    """Points, xG, xA and minutes for his club's last few gameweeks.

    A double gameweek has two history rows with the same round, so they
    get added together into one bar.
    """
    by_round = {}
    for row in history_rows:
        week = by_round.setdefault(row["round"], {"gameweek": row["round"], "points": 0, "xg": 0.0, "xa": 0.0, "minutes": 0})
        week["points"] += row["total_points"]
        week["xg"] += float(row.get("expected_goals") or 0)
        week["xa"] += float(row.get("expected_assists") or 0)
        week["minutes"] += row["minutes"]
    latest = sorted(by_round.values(), key=lambda week: week["gameweek"])[-count:]
    for week in latest:
        week["xg"] = round(week["xg"], 2)
        week["xa"] = round(week["xa"], 2)
    return latest


def minutes_per_match(history_rows, count=RECENT_MINUTES_MATCHES):
    """Average minutes over his club's last few matches, counting games he missed as 0."""
    recent = history_rows[-count:]
    return round(sum(row["minutes"] for row in recent) / len(recent)) if recent else 0


def next_fixtures(ticker_team, position_name, count=NEXT_FIXTURES):
    """His club's next few matches from the Fixture Ticker, rated for his position.

    Keepers and defenders get the clean-sheet difficulty; everyone else
    gets the attacking one.
    """
    key = "defenceDifficulty" if position_name in ("GK", "DEF") else "attackDifficulty"
    matches = []
    for week, week_matches in sorted(ticker_team["matches"].items(), key=lambda item: int(item[0])):
        for match in week_matches:
            matches.append({"gameweek": int(week), "opponent": match["opponent"], "isHome": match["isHome"], "difficulty": match[key]})
    return matches[:count]


def build_player_details(bootstrap, histories, model_results, squad_state, ticker, price_watch, position_names):
    """The detail entry for every player, keyed by player id as a string."""
    teams_by_id = {team["id"]: team for team in bootstrap["teams"]}
    ticker_by_team = {team["id"]: team for team in ticker["teams"]}
    price_by_player = {row["id"]: row for row in price_watch["players"]}
    position_full_names = {kind["id"]: kind["singular_name"] for kind in bootstrap["element_types"]}
    first_week = squad_state.gameweek

    details = {}
    for player in bootstrap["elements"]:
        history_rows = histories.get(player["id"], [])
        rates = model_results.rates_by_player[player["id"]]
        price_row = price_by_player.get(player["id"])
        position_name = position_names[player["element_type"]]
        details[str(player["id"])] = {
            "id": player["id"],
            "name": player["web_name"],
            "fullName": f'{player["first_name"]} {player["second_name"]}',
            "team": teams_by_id[player["team"]]["short_name"],
            "teamName": teams_by_id[player["team"]]["name"],
            "position": position_name,
            "positionName": position_full_names[player["element_type"]],
            "price": player["now_cost"],
            "sellingPrice": squad_state.selling_prices.get(player["id"]),
            "ownership": float(player["selected_by_percent"]),
            "chance": player.get("chance_of_playing_next_round"),
            "news": player.get("news") or "",
            "yellowCards": player.get("yellow_cards", 0),
            "penaltyOrder": player.get("penalties_order"),
            "nextGameweek": first_week,
            "xpNext": model_results.expected_points[player["id"]].get(first_week, 0.0),
            "minutesPerMatch": minutes_per_match(history_rows),
            "xgPer90": round(rates.xg_per_90, 2),
            "xaPer90": round(rates.xa_per_90, 2),
            "recent": recent_gameweeks(history_rows),
            "fixtures": next_fixtures(ticker_by_team[player["team"]], position_name),
            "priceProgress": price_row["progress"] if price_row else 0.0,
            "pricePrediction": price_row["prediction"] if price_row else "No change",
        }
    return details
