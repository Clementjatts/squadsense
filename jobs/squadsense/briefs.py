"""What the two gameweek briefs say: the plan as labeled rows.

The plan brief (about a day before the deadline) and the final call
(about 2.5 hours before) both list this week's transfers, captain and
chips. Each row carries a tag so you know what to act on:

- FIRM: the plan is sure of it.
- CLOSE CALL: another choice is worth about the same, so either is fine.
- MAKE NOW: a price change tonight makes this move worth doing early.

The plan brief is saved, so the final call can say what changed since.
"""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

FIRM_SHARE = 0.7  # share of noisy re-solves that must make a move the same week
CAPTAIN_CLOSE_XP = 0.5  # a second captain option this close makes the pick a close call
PERMANENT_CHIPS = ("wildcard", "freehit")  # FPL can't cancel these once confirmed
UK = ZoneInfo("Europe/London")


@dataclass
class Row:
    """One line of a brief: what it is, the advice, and an optional tag."""

    label: str
    value: str
    tag: str | None = None


def name_of(snapshot, player_id):
    """A player's short name, or his id if the snapshot doesn't have him."""
    return snapshot["players"].get(str(player_id), {}).get("name", f"#{player_id}")


def first_week(snapshot):
    """The first week of the transfer plan, or None for a model-picked squad."""
    plan = snapshot.get("solverPlan")
    return plan["weeks"][0] if plan else None


def move_tag(move):
    """MAKE NOW for a price-driven move, otherwise FIRM or CLOSE CALL from the re-solves."""
    if move.get("priceNote"):
        return "MAKE NOW"
    share = move.get("sameWeekShare")
    if share is None:
        return None  # older plans have no re-solves to judge by
    return "FIRM" if share >= FIRM_SHARE else "CLOSE CALL"


def transfer_rows(snapshot, week):
    """One row per transfer this week, or one row saying to roll."""
    if not week["moves"]:
        return [Row("Transfer", "None. Roll the free transfer.")]
    return [Row("Transfer", f"{name_of(snapshot, move['out'])} → {name_of(snapshot, move['in'])}", move_tag(move))
            for move in week["moves"]]


def plan_captain(snapshot):
    """The plan's captain, falling back to the top captain option."""
    week = first_week(snapshot)
    if week:
        return week["captain"]
    options = snapshot["captainOptions"]
    return options[0]["playerId"] if options else None


def captain_row(snapshot):
    """Captain and vice, marked a close call when the next option is nearly as good."""
    captain = plan_captain(snapshot)
    if captain is None:
        return []
    xp = {option["playerId"]: option["xp"] for option in snapshot["captainOptions"]}
    others = [player_id for player_id in xp if player_id != captain]
    if not others:
        return [Row("Captain", name_of(snapshot, captain))]
    vice = others[0]
    tag = None
    if captain in xp:
        tag = "CLOSE CALL" if xp[captain] - xp[vice] < CAPTAIN_CLOSE_XP else "FIRM"
    return [Row("Captain", f"{name_of(snapshot, captain)} (vice {name_of(snapshot, vice)})", tag)]


def chip_rows(snapshot):
    """This week's chip, then the chips the plan has in mind for later weeks."""
    gameweek = snapshot["gameweek"]
    cards = [card for card in (snapshot.get("chipPlan") or {}).get("cards", []) if card["decision"]]
    now = [card for card in cards if card["decision"]["action"] == "play" and card["decision"]["week"] == gameweek]
    later = [card for card in cards if card not in now and card["decision"]["week"]]
    rows = []
    for card in now:
        warning = " It can't be undone." if card["chip"] in PERMANENT_CHIPS else ""
        rows.append(Row("Chip", f"Play {card['label']} this week.{warning}", close_tag(card)))
    if not now:
        rows.append(Row("Chip", "None this week."))
    for card in sorted(later, key=lambda card: card["decision"]["week"]):
        rows.append(Row("Later", f"{card['label']} in GW{card['decision']['week']}", close_tag(card)))
    return rows


def close_tag(card):
    """The strategy's own verdict on a chip: a close call or firm."""
    return "CLOSE CALL" if card["decision"]["closeCall"] else "FIRM"


def plan_rows(snapshot):
    """Every row of a brief, in reading order: transfers, captain, chips."""
    week = first_week(snapshot)
    return (transfer_rows(snapshot, week) if week else []) + captain_row(snapshot) + chip_rows(snapshot)


def brief_summary(snapshot):
    """The parts of the plan the final call compares: moves, captain and chip weeks."""
    week = first_week(snapshot)
    cards = (snapshot.get("chipPlan") or {}).get("cards", [])
    return {
        "moves": [[move["out"], move["in"]] for move in week["moves"]] if week else [],
        "captain": plan_captain(snapshot),
        "chips": {card["chip"]: card["decision"]["week"] for card in cards
                  if card["decision"] and card["decision"]["action"] == "play"},
    }


def describe_moves(snapshot, moves):
    """Moves as words, for a 'was' line."""
    return ", ".join(f"{name_of(snapshot, out)} → {name_of(snapshot, into)}" for out, into in moves) or "no transfers"


def changes_since(saved, snapshot):
    """Sentences for what moved between the plan brief and now. Empty with no saved brief."""
    if not saved:
        return []
    current = brief_summary(snapshot)
    lines = []
    if saved["moves"] != current["moves"]:
        lines.append(f"Transfers were {describe_moves(snapshot, saved['moves'])}")
    if saved["captain"] != current["captain"]:
        lines.append(f"Captain was {name_of(snapshot, saved['captain'])}")
    labels = {card["chip"]: card["label"] for card in (snapshot.get("chipPlan") or {}).get("cards", [])}
    for chip in sorted(set(saved["chips"]) | set(current["chips"])):
        before = saved["chips"].get(chip)
        if before != current["chips"].get(chip):
            lines.append(f"{labels.get(chip, chip)} was {f'planned for GW{before}' if before else 'not planned'}")
    return lines


def uk_time(iso):
    """An FPL timestamp as UK time, like 'Fri 27 Nov, 18:30 UK'."""
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UK)
    return f"{moment:%a} {moment.day} {moment:%b, %H:%M} UK"
