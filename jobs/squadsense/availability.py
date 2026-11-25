"""How likely a player is to be available for each match in the plan.

FPL's `chance_of_playing_next_round` (0, 25, 50, 75 or 100) only covers
the next gameweek. Using it for every week of a five-week plan treated a
player serving a one-match ban as worth nothing for five weeks, so the
plan sold players who only needed to sit out one game.

So the next gameweek keeps FPL's flag, and later matches are read from
FPL's status and news:

- a date in the news ("Expected back 20 Dec", "Suspended until 5 Dec"):
  out for matches before it, available from it;
- suspended with no date: one match, then back;
- doubtful (a 25 to 75% chance): only the next gameweek is affected;
- injured with an unknown return, or gone from the club: out every week.
"""

import re
from datetime import date, datetime

MONTHS = {name: number for number, name in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}
DATE_IN_NEWS = re.compile(r"(?:Expected back|Suspended until)\s+(\d{1,2})\s+([A-Z][a-z]{2})")
OUT_EVERY_WEEK = ("i", "u", "n")  # injured with no date, unavailable (left the club), not in the competition


def kickoff_date(kickoff):
    """The date of an FPL kick-off time like 2026-11-28T15:00:00Z."""
    return datetime.fromisoformat(kickoff.replace("Z", "+00:00")).date()


def return_date(news, kickoff):
    """The return date in FPL's news, in the year that puts it nearest the match, or None without one."""
    found = DATE_IN_NEWS.search(news or "")
    if not found or found.group(2) not in MONTHS:
        return None
    match_day = kickoff_date(kickoff)
    back = date(match_day.year, MONTHS[found.group(2)], int(found.group(1)))
    # News written in December about "2 Jan" means next year, and the reverse.
    if (back - match_day).days > 182:
        back = back.replace(year=back.year - 1)
    elif (match_day - back).days > 182:
        back = back.replace(year=back.year + 1)
    return back


def status_of(player):
    """FPL's status letter. Past seasons and test data have none, so it's read from the chance."""
    if player.get("status"):
        return player["status"]
    chance = player.get("chance_of_playing_next_round")
    return "a" if chance is None else "i" if chance == 0 else "d"


def next_week_chance(player):
    """FPL's own flag for the next gameweek, as 0 to 1 (no flag means available)."""
    chance = player.get("chance_of_playing_next_round")
    return 1.0 if chance is None else chance / 100


def match_availability(player, match, later_week):
    """The chance, 0 to 1, that the player is available for this match.

    The next gameweek (`later_week` False) uses FPL's flag. Later matches
    follow the rules in this module's description.
    """
    if not later_week:
        return next_week_chance(player)
    status = status_of(player)
    back = return_date(player.get("news"), match["kickoff"]) if match.get("kickoff") else None
    if back is not None:
        return 1.0 if kickoff_date(match["kickoff"]) >= back else 0.0
    return 0.0 if status in OUT_EVERY_WEEK else 1.0
