"""Data for the Price Watch page, taken from FPL's own price change predictor.

In 2026/27 every player in bootstrap-static carries FPL's official numbers:

- `price_change_percent`: progress towards the next change right now.
  Past +100 or -100 means he should rise or fall at the next change,
  which happens at 00:00 UK time.
- `price_change_projections`: where that progress is expected to be at
  the next few changes. Each has a `likelihood` from -5 to 5. Looking at
  live data, it's a banding of the projected percentage: 5 means past
  100%, 4 means 95-100%, 3 means 40-95%, and so on, negative for falls.
- `price_change_locked_until`: set when FPL has frozen his price for now.

We only read the first projection (the next change). How far ahead the
later ones look isn't documented anywhere we've found.
"""

# Our wording for each likelihood band. The sign gives the direction.
LIKELIHOOD_LABELS = {5: "Changes tonight", 4: "Very likely", 3: "Likely", 2: "Possible", 1: "Unlikely", 0: "No change"}
# Bands of 3 or more count as a real risk or chance for the summary cards.
ALERT_LIKELIHOOD = 3


def prediction_label(likelihood, locked_until):
    """Short text for the Prediction column, e.g. "Very likely" or "Price locked"."""
    if locked_until:
        return "Price locked"
    return LIKELIHOOD_LABELS[abs(likelihood)]


def next_change(player):
    """The first projection (next price change), or None if FPL sent none."""
    projections = player.get("price_change_projections") or []
    return min(projections, key=lambda projection: projection["offset"]) if projections else None


def watch_row(player, teams_by_id, position_names, squad_ids):
    """One player's row for the Price Watch table."""
    projection = next_change(player)
    likelihood = projection["likelihood"] if projection else 0
    return {
        "id": player["id"],
        "name": player["web_name"],
        "team": teams_by_id[player["team"]]["short_name"],
        "position": position_names[player["element_type"]],
        "price": player["now_cost"],
        "ownership": float(player["selected_by_percent"]),
        "netTransfers": player["transfers_in_event"] - player["transfers_out_event"],
        "progress": float(player["price_change_percent"]),
        "projected": float(projection["projected_percent"]) if projection else None,
        "likelihood": likelihood,
        "prediction": prediction_label(likelihood, player.get("price_change_locked_until")),
        "lockedUntil": player.get("price_change_locked_until"),
        "changedThisWeek": player["cost_change_event"],
        "inSquad": player["id"] in squad_ids,
    }


def build_price_watch(bootstrap, squad_ids, position_names):
    """Every player FPL is tracking, closest to a change first, plus the summary cards.

    Players with no movement at all are left out unless they're in the
    squad, to keep the snapshot small.
    """
    teams_by_id = {team["id"]: team for team in bootstrap["teams"]}
    rows = [
        watch_row(player, teams_by_id, position_names, squad_ids)
        for player in bootstrap["elements"]
        if float(player["price_change_percent"]) != 0 or player["id"] in squad_ids
    ]
    rows.sort(key=lambda row: abs(row["progress"]), reverse=True)

    mine = [row for row in rows if row["inSquad"] and not row["lockedUntil"]]
    return {
        "calibrating": any(player.get("price_change_calibrating") for player in bootstrap["elements"]),
        "atRisk": [row["id"] for row in mine if row["likelihood"] <= -ALERT_LIKELIHOOD],
        "rising": [row["id"] for row in mine if row["likelihood"] >= ALERT_LIKELIHOOD],
        "players": rows,
    }
