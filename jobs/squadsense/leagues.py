"""Mini-league intelligence: what your rivals own, who they captain, where you differ.

Beating a mini-league is a different game from chasing overall rank. A
player every rival owns can't gain you ground; one nobody owns can win
or lose you a week on his own. This module reads each rival's picks for
the last gameweek that has passed its deadline and works out:

- the league table (rank, total, last week's points, chip played),
- how many rivals own and captain each player,
- threats: players most rivals own and you don't, ranked by next week's xP,
- differentials: your players few rivals own.

It also reads each rival's season history for the chips they've played,
so the Chip Planner can show what your rivals still have.

Rival picks for a past deadline never change, so each one is cached and
only fetched once per gameweek. Histories are cached the same way.
"""

import logging
import os
from collections import Counter

from .fpl_client import FplApiError

log = logging.getLogger("squadsense.leagues")

MAX_LEAGUE_SIZE = 50  # one page of standings; bigger leagues aren't really mini-leagues
MAX_LEAGUES = 4
ALL_CHIPS = ("bboost", "3xc", "freehit", "wildcard")
RIVAL_CHIP_ROWS = 12  # rivals listed per league on the Chip Planner
THREATS_SHOWN = 6
DIFFERENTIALS_SHOWN = 6
THREAT_MIN_SHARE = 0.3  # at least this share of rivals own him
DIFFERENTIAL_MAX_SHARE = 0.25


def league_ids_from_env():
    """League ids from SQUADSENSE_LEAGUES ("123,456"), or an empty list."""
    raw = os.environ.get("SQUADSENSE_LEAGUES", "")
    return [int(part) for part in raw.split(",") if part.strip()]


def choose_leagues(team_entry, chosen_ids=None):
    """The leagues to analyse: the ones named, or the smallest private ones.

    Private leagues have league_type "x". Public ones such as "Overall"
    have millions of teams, so they're left out.
    """
    classic = team_entry.get("leagues", {}).get("classic", [])
    if chosen_ids:
        return [league for league in classic if league["id"] in chosen_ids]
    private = [
        league for league in classic
        if league["league_type"] == "x" and 0 < (league.get("rank_count") or 0) <= MAX_LEAGUE_SIZE
    ]
    return sorted(private, key=lambda league: league["rank_count"])[:MAX_LEAGUES]


def cached_picks(client, storage, entry_id, gameweek):
    """One team's picks for a past deadline, from the cache when we have them.

    Returns None, with a logged warning, for a team with no picks that
    week (for example one created after it).
    """
    name = f"picks/{entry_id}/{gameweek}"
    picks = storage.load_raw(name)
    if picks is not None:
        return picks
    try:
        picks = client.entry_picks(entry_id, gameweek)
    except FplApiError as error:
        log.warning("No GW%d picks for team %d: %s", gameweek, entry_id, error)
        return None
    storage.save_raw(name, picks)
    return picks


def cached_history(client, storage, entry_id, gameweek):
    """One team's entry history, fetched once per gameweek. None, with a warning, if it fails."""
    name = f"history/{entry_id}/{gameweek}"
    history = storage.load_raw(name)
    if history is not None:
        return history
    try:
        history = client.entry_history(entry_id)
    except FplApiError as error:
        log.warning("No history for team %d: %s", entry_id, error)
        return None
    storage.save_raw(name, history)
    return history


def fetch_leagues(client, storage, team_entry, gameweek, chosen_ids=None):
    """Standings and every rival's picks for each chosen league.

    Returns a list of {"info", "standings", "picks"} where `picks` maps
    team id to that team's picks for `gameweek` (None if it has none).
    Your own team is left out of `picks`; the sync reads those itself.
    """
    my_team_id = team_entry["id"]
    leagues = []
    for info in choose_leagues(team_entry, chosen_ids):
        standings = client.league_standings(info["id"])["standings"]["results"]
        picks = {
            row["entry"]: cached_picks(client, storage, row["entry"], gameweek)
            for row in standings if row["entry"] != my_team_id
        }
        histories = {entry: cached_history(client, storage, entry, gameweek) for entry in picks}
        log.info("League %s: %d teams", info["name"], len(standings))
        leagues.append({"info": info, "standings": standings, "picks": picks, "histories": histories})
    return leagues


def chips_left(history, half):
    """The chips a team hasn't played yet in this half of the season, or None if unknown."""
    if history is None:
        return None
    start, stop = half
    played = {chip["name"] for chip in history.get("chips", []) if start <= chip["event"] <= stop}
    return [chip for chip in ALL_CHIPS if chip not in played]


def table_rows(standings, picks, histories, half):
    """The league table, with each team's chip, captain and chips left."""
    rows = []
    for row in standings:
        team_picks = picks.get(row["entry"]) or {}
        captain = next((pick["element"] for pick in team_picks.get("picks", []) if pick["is_captain"]), None)
        rows.append({
            "entry": row["entry"],
            "teamName": row["entry_name"],
            "manager": row["player_name"],
            "rank": row["rank"],
            "lastRank": row["last_rank"],
            "total": row["total"],
            "eventPoints": row["event_total"],
            "chip": team_picks.get("active_chip"),
            "captain": captain,
            "chipsLeft": chips_left(histories.get(row["entry"]), half),
        })
    return rows


def rival_counts(picks, my_team_id):
    """How many rivals own and captain each player, and how many rivals had picks."""
    owned, captained = Counter(), Counter()
    rivals = [team_picks for entry, team_picks in picks.items() if entry != my_team_id and team_picks]
    for team_picks in rivals:
        for pick in team_picks["picks"]:
            owned[pick["element"]] += 1
            captained[pick["element"]] += pick["is_captain"]
    return owned, captained, len(rivals)


def summarise_league(league, my_team_id, my_squad, expected_points, next_week, half):
    """Everything the Leagues page shows for one league."""
    owned, captained, rival_total = rival_counts(league["picks"], my_team_id)
    share = lambda player_id: owned[player_id] / rival_total if rival_total else 0.0
    next_xp = lambda player_id: expected_points.get(player_id, {}).get(next_week, 0.0)

    threats = sorted(
        (player_id for player_id in owned if player_id not in my_squad and share(player_id) >= THREAT_MIN_SHARE),
        key=lambda player_id: share(player_id) * next_xp(player_id), reverse=True,
    )[:THREATS_SHOWN]
    differentials = sorted(
        (player_id for player_id in my_squad if share(player_id) <= DIFFERENTIAL_MAX_SHARE),
        key=next_xp, reverse=True,
    )[:DIFFERENTIALS_SHOWN]

    def player_line(player_id):
        return {"playerId": player_id, "share": round(share(player_id), 3), "xp": next_xp(player_id),
                "captainShare": round(captained[player_id] / rival_total, 3) if rival_total else 0.0}

    rows = table_rows(league["standings"], league["picks"], league.get("histories", {}), half)
    my_row = next((row for row in rows if row["entry"] == my_team_id), None)
    return {
        "id": league["info"]["id"],
        "name": league["info"]["name"],
        "size": len(rows),
        "rivalsWithPicks": rival_total,
        "myRank": my_row["rank"] if my_row else None,
        "table": rows,
        "mySquad": [player_line(player_id) for player_id in my_squad],
        "threats": [player_line(player_id) for player_id in threats],
        "differentials": [player_line(player_id) for player_id in differentials],
        "topCaptains": [player_line(player_id) for player_id, _ in captained.most_common(3)],
    }


def build_leagues(league_data, my_team_id, my_squad, expected_points, next_week, half):
    """One summary per league fetched by fetch_leagues(). `half` is the chip window (start, stop)."""
    return [summarise_league(league, my_team_id, set(my_squad), expected_points, next_week, half) for league in league_data]


def rival_chip_summary(leagues):
    """For the Chip Planner: per league, how many rivals hold each chip, and the top rivals' chips left."""
    summaries = []
    for league in leagues:
        known = [row for row in league["table"] if row["chipsLeft"] is not None]
        summaries.append({
            "id": league["id"],
            "name": league["name"],
            "rivals": len(known),
            "holding": {chip: sum(chip in row["chipsLeft"] for row in known) for chip in ALL_CHIPS},
            "rows": [
                {"entry": row["entry"], "teamName": row["teamName"], "rank": row["rank"], "total": row["total"], "chipsLeft": row["chipsLeft"]}
                for row in known[:RIVAL_CHIP_ROWS]
            ],
        })
    return summaries


def players_mentioned(leagues):
    """Every player id a league summary refers to, so the snapshot can include them."""
    ids = set()
    for league in leagues:
        for key in ("threats", "differentials", "topCaptains", "mySquad"):
            ids.update(line["playerId"] for line in league[key])
        ids.update(row["captain"] for row in league["table"] if row["captain"])
    return ids
