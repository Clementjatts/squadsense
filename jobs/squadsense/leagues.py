"""Mini-league intelligence: what your rivals own, who they captain, where you differ.

Beating a mini-league is a different game from chasing overall rank. A
player every rival owns can't gain you ground; one nobody owns can win
or lose you a week on his own. This module reads each rival's picks for
the last gameweek that has passed its deadline and works out:

- the league table (rank, total, last week's points, chip played),
- how many rivals own and captain each player,
- this week's exposure: effective ownership (captains count twice, the
  bench not at all) against your planned team, and the points each player
  is expected to gain or cost you against the average rival.

It also reads each rival's season history for the chips they've played,
so the Chip Planner can show what your rivals still have.

Every private league you're in is listed. Reading rivals' picks costs two
requests per rival, so that full analysis is only done for leagues of up
to FULL_ANALYSIS_MAX teams. Bigger leagues get the top 50 and the 50
around you, fetched once a day, plus the picks of a sample: the top
SAMPLE_TOP teams and the SAMPLE_AROUND teams either side of you. So every
league gets the same exposure and captains, and the page says whether
they come from every rival or the sample. A big league's exposure is split
into its leaders and the teams around you.

Rival picks for a past deadline never change, so each one is cached and
only fetched once per gameweek. Histories are cached the same way.
"""

import datetime
import logging
import math
import os
from collections import Counter

from .fpl_client import FplApiError

log = logging.getLogger("squadsense.leagues")

FULL_ANALYSIS_MAX = 100  # rivals' picks are read for leagues this size or smaller
STANDINGS_PAGE_SIZE = 50  # FPL returns a league table 50 teams at a time
ALL_CHIPS = ("bboost", "3xc", "freehit", "wildcard")
RIVAL_CHIP_ROWS = 12  # rivals listed per league on the Chip Planner
SAMPLE_TOP = 10  # a big league's leaders whose picks are read
SAMPLE_AROUND = 10  # teams read just above and just below you in a big league
EXPOSURE_SHOWN = 6  # players in each of "Costing you" and "Gaining you"
STARTING_POSITIONS = 11  # FPL lists the starting eleven in positions 1 to 11


def league_ids_from_env():
    """League ids from SQUADSENSE_LEAGUES ("123,456"), or an empty list."""
    raw = os.environ.get("SQUADSENSE_LEAGUES", "")
    return [int(part) for part in raw.split(",") if part.strip()]


def choose_leagues(team_entry, chosen_ids=None):
    """The leagues to show: the ones named, or every private league, smallest first.

    Private leagues have league_type "x". Public ones such as "Overall"
    have millions of teams, so they're left out.
    """
    classic = team_entry.get("leagues", {}).get("classic", [])
    if chosen_ids:
        chosen = [league for league in classic if league["id"] in chosen_ids]
    else:
        chosen = [league for league in classic if league["league_type"] == "x" and (league.get("rank_count") or 0) > 0]
    return sorted(chosen, key=lambda league: league.get("rank_count") or 0)


def is_fully_analysed(info):
    """True for a league small enough to read every rival's picks."""
    return (info.get("rank_count") or 0) <= FULL_ANALYSIS_MAX


def all_standings(client, league_id):
    """Every row of a small league's table, reading as many 50-team pages as it has."""
    rows, page = [], 1
    while True:
        standings = client.league_standings(league_id, page)["standings"]
        rows.extend(standings["results"])
        if not standings.get("has_next") or page * STANDINGS_PAGE_SIZE >= FULL_ANALYSIS_MAX:
            return rows
        page += 1


def top_and_nearby_standings(client, storage, info, today):
    """A big league's top 50 and the 50 teams around you, saved and reused for a day.

    Big leagues barely change within a day, and fetching them on every
    sync would cost two requests per league each time.
    """
    name = f"standings/{info['id']}"
    saved = storage.load_raw(name)
    if saved and saved.get("day") == today:
        return saved["rows"]
    my_page = math.ceil((info.get("entry_rank") or 1) / STANDINGS_PAGE_SIZE)
    rows = {}
    for page in sorted({1, my_page}):
        for row in client.league_standings(info["id"], page)["standings"]["results"]:
            rows[row["entry"]] = row
    ordered = sorted(rows.values(), key=lambda row: row["rank"])
    storage.save_raw(name, {"day": today, "rows": ordered})
    return ordered


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


def fetch_leagues(client, storage, team_entry, gameweek, chosen_ids=None, today=None):
    """Standings for every chosen league, plus rivals' picks for the small ones.

    Returns a list of {"info", "kind", "standings", "picks", "histories"}.
    `kind` is "full" when every rival's picks for `gameweek` were read,
    and "table" for a big league, whose `picks` and `histories` are empty.
    Your own team is left out of `picks`; the sync reads those itself.
    """
    today = today or datetime.date.today().isoformat()
    leagues = []
    for info in choose_leagues(team_entry, chosen_ids):
        if is_fully_analysed(info):
            leagues.append(fetch_full_league(client, storage, info, team_entry["id"], gameweek))
        else:
            leagues.append(fetch_big_league(client, storage, info, team_entry["id"], gameweek, today))
    return leagues


def sample_entries(standings, my_rank, my_team_id):
    """The teams whose picks stand in for a big league: its leaders and the teams either side of you."""
    by_rank = sorted(standings, key=lambda row: row["rank"])
    leaders = [row["entry"] for row in by_rank[:SAMPLE_TOP]]
    nearby = [row["entry"] for row in by_rank if my_rank and abs(row["rank"] - my_rank) <= SAMPLE_AROUND and row["rank"] != my_rank]
    return [entry for entry in dict.fromkeys(leaders + nearby) if entry != my_team_id]


def fetch_big_league(client, storage, info, my_team_id, gameweek, today):
    """A big league's top 50 and the 50 around you, with the picks of the sample (no chip histories)."""
    standings = top_and_nearby_standings(client, storage, info, today)
    entries = sample_entries(standings, info.get("entry_rank"), my_team_id)
    picks = {entry: cached_picks(client, storage, entry, gameweek) for entry in entries}
    log.info("League %s: %d teams, %d rivals' picks read as a sample", info["name"], info.get("rank_count") or 0, len(picks))
    return {"info": info, "kind": "table", "standings": standings, "picks": picks, "histories": {}}


def sample_groups(standings, my_rank, my_team_id):
    """{entry: groups} for a big league's table: "top" for its leaders, "around" for the teams either side of you.

    You're in both, since each group is compared with you. A team near the
    top can be in both too.
    """
    leaders = {row["entry"] for row in sorted(standings, key=lambda row: row["rank"])[:SAMPLE_TOP]}

    def groups(row):
        if row["entry"] == my_team_id:
            return ["top", "around"]
        found = ["top"] if row["entry"] in leaders else []
        if my_rank and abs(row["rank"] - my_rank) <= SAMPLE_AROUND:
            found.append("around")
        return found

    return {row["entry"]: groups(row) for row in standings}


def rival_multiplier(pick):
    """How many times a rival's player scores in a normal week: 2 as captain, 1 starting, 0 on the bench.

    A Triple Captain or Bench Boost was a one-off, so last week's chip is
    ignored and the lineup is read as a normal week.
    """
    if pick["position"] > STARTING_POSITIONS:
        return 0
    return 2 if pick["is_captain"] else 1


def league_exposure(rival_picks, my_multipliers, next_xp):
    """Effective ownership among rivals against your planned team, for the coming week.

    `rival_picks` are rivals' last lineups (their new picks stay hidden until
    the deadline); a rival who played Free Hit is left out, since that squad
    is gone. `my_multipliers` is {player: 1 starting, 2 captain} from the
    plan, and `next_xp(player)` his xP for the coming week. Each player's
    swing is (your multiplier minus the rivals' average) times his xP: what
    he's expected to gain or cost you against the average rival.
    Returns {"rivals", "swing" (all players added up), "costing", "gaining"}.
    """
    rivals = [team for team in rival_picks if team and team.get("active_chip") != "freehit"]
    if not rivals:
        return {"rivals": 0, "swing": 0.0, "costing": [], "gaining": []}
    effective, owned, captained = Counter(), Counter(), Counter()
    for team in rivals:
        for pick in team["picks"]:
            owned[pick["element"]] += 1
            captained[pick["element"]] += pick["is_captain"]
            effective[pick["element"]] += rival_multiplier(pick)

    lines = []
    for player in set(owned) | {player for player, multiplier in my_multipliers.items() if multiplier}:
        eo = effective[player] / len(rivals)
        mine = my_multipliers.get(player, 0)
        lines.append({
            "playerId": player, "owned": round(owned[player] / len(rivals), 3), "captained": round(captained[player] / len(rivals), 3),
            "eo": round(eo, 3), "mine": mine, "xp": round(next_xp(player), 2), "swing": round((mine - eo) * next_xp(player), 2),
        })
    return {
        "rivals": len(rivals),
        "swing": round(sum(line["swing"] for line in lines), 1),
        "costing": sorted((line for line in lines if line["swing"] < -0.05), key=lambda line: line["swing"])[:EXPOSURE_SHOWN],
        "gaining": sorted((line for line in lines if line["swing"] > 0.05), key=lambda line: -line["swing"])[:EXPOSURE_SHOWN],
    }


def exposure_groups(league, my_team_id, my_multipliers, next_xp):
    """The exposure card's groups: one of everyone for a small league, "Top 10" and "Around you" for a big one."""
    rivals = {entry: picks for entry, picks in league["picks"].items() if entry != my_team_id}
    if league["kind"] == "full":
        return [{"key": "all", "label": "Everyone", **league_exposure(list(rivals.values()), my_multipliers, next_xp)}]
    groups = sample_groups(league["standings"], league["info"].get("entry_rank"), my_team_id)
    found = []
    for key, label in (("top", "Top 10"), ("around", "Around you")):
        members = [picks for entry, picks in rivals.items() if key in groups.get(entry, [])]
        if members:
            found.append({"key": key, "label": label, **league_exposure(members, my_multipliers, next_xp)})
    return found


def live_league(league, my_team_id, my_picks):
    """One league for the Live page: each team's picks and its total before the week.

    A small ("full") league sends every team. A big league sends only its
    sample plus you, as kind "sample", each team tagged with its groups:
    "top" for the league's leaders, "around" for the teams either side of
    you. You're in both, since the page compares you with each group.
    """
    info, standings = league["info"], league["standings"]
    picks = {**league["picks"], my_team_id: my_picks}
    sample = league["kind"] != "full"
    groups = sample_groups(standings, info.get("entry_rank"), my_team_id)

    teams = []
    for row in standings:
        if sample and row["entry"] not in picks:
            continue
        team = {
            "entry": row["entry"],
            "teamName": row["entry_name"],
            "rank": row["rank"],
            "totalBefore": row["total"] - row["event_total"],
            "picks": (picks.get(row["entry"]) or {}).get("picks", []),
            "chip": (picks.get(row["entry"]) or {}).get("active_chip"),
        }
        if sample:
            team["groups"] = groups[row["entry"]]
        teams.append(team)
    return {"id": info["id"], "name": info["name"], "kind": "sample" if sample else "full", "size": info.get("rank_count") or len(standings), "teams": teams}


def fetch_full_league(client, storage, info, my_team_id, gameweek):
    """A small league's whole table, with every rival's picks and chip history."""
    standings = all_standings(client, info["id"])
    picks = {
        row["entry"]: cached_picks(client, storage, row["entry"], gameweek)
        for row in standings if row["entry"] != my_team_id
    }
    histories = {entry: cached_history(client, storage, entry, gameweek) for entry in picks}
    log.info("League %s: %d teams, rivals' picks read", info["name"], len(standings))
    return {"info": info, "kind": "full", "standings": standings, "picks": picks, "histories": histories}


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
            # Tied teams share a rank (11, 11, 13); rank_sort counts on without gaps.
            "position": row.get("rank_sort", row["rank"]),
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


def standing(table, my_team_id):
    """Where you stand: points behind the leader, and the gaps to the teams just above and below you.

    None when you aren't in the table. In a big league the teams above and
    below come from the 50 rows around you, which are always next to you.
    """
    rows = sorted(table, key=lambda row: row["rank"])
    mine = next((index for index, row in enumerate(rows) if row["entry"] == my_team_id), None)
    if mine is None:
        return None
    me = rows[mine]
    above = rows[mine - 1] if mine > 0 else None
    below = rows[mine + 1] if mine + 1 < len(rows) else None
    return {
        "leaderGap": rows[0]["total"] - me["total"],
        "above": {"teamName": above["teamName"], "gap": above["total"] - me["total"]} if above else None,
        "below": {"teamName": below["teamName"], "gap": me["total"] - below["total"]} if below else None,
    }


def summarise_league(league, my_team_id, my_squad, my_multipliers, expected_points, next_week, half):
    """Everything the Leagues page shows for one league.

    `my_multipliers` is your planned team for `next_week` ({player: 1
    starting, 2 captain}), which the exposure card compares with rivals.
    """
    owned, captained, rival_total = rival_counts(league["picks"], my_team_id)
    share = lambda player_id: owned[player_id] / rival_total if rival_total else 0.0
    next_xp = lambda player_id: expected_points.get(player_id, {}).get(next_week, 0.0)

    def player_line(player_id):
        return {"playerId": player_id, "share": round(share(player_id), 3), "xp": next_xp(player_id),
                "captainShare": round(captained[player_id] / rival_total, 3) if rival_total else 0.0}

    rows = table_rows(league["standings"], league["picks"], league.get("histories", {}), half)
    my_row = next((row for row in rows if row["entry"] == my_team_id), None)
    info = league["info"]
    return {
        "id": info["id"],
        "name": info["name"],
        "kind": league.get("kind", "full"),
        "picksFrom": "all" if league.get("kind", "full") == "full" else "sample",
        "standing": standing(rows, my_team_id),
        "size": info.get("rank_count") or len(rows),
        "rivalsWithPicks": rival_total,
        "myRank": my_row["rank"] if my_row else info.get("entry_rank"),
        "myLastRank": my_row["lastRank"] if my_row else info.get("entry_last_rank"),
        "table": rows,
        "mySquad": [player_line(player_id) for player_id in my_squad],
        # Rivals' last lineups against your planned team (their new picks are hidden until the deadline).
        "exposure": {"picksWeek": next_week - 1, "groups": exposure_groups(league, my_team_id, my_multipliers, next_xp)},
        "topCaptains": [player_line(player_id) for player_id, _ in captained.most_common(3)],
    }


def build_leagues(league_data, my_team_id, my_squad, my_multipliers, expected_points, next_week, half):
    """One summary per league fetched by fetch_leagues(). `half` is the chip window (start, stop)."""
    return [summarise_league(league, my_team_id, set(my_squad), my_multipliers, expected_points, next_week, half) for league in league_data]


def rival_chip_summary(leagues):
    """For the Chip Planner: per league, how many rivals hold each chip, and the top rivals' chips left.

    Only fully analysed leagues are included; big leagues have no chip histories.
    """
    summaries = []
    for league in (league for league in leagues if league["kind"] == "full"):
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
        for key in ("topCaptains", "mySquad"):
            ids.update(line["playerId"] for line in league[key])
        for group in league["exposure"]["groups"]:
            ids.update(line["playerId"] for line in group["costing"] + group["gaining"])
        ids.update(row["captain"] for row in league["table"] if row["captain"])
    return ids
