"""The "What changed" feed: what moved between one sync and the next.

Each sync keeps a short summary of the snapshot (your players' xP, news
and prices, the plan's first-week moves, chip decisions, captain, squad
and gameweek). The next sync compares its own summary with that one and
writes down anything that changed in a sentence, so you can see why the
advice moved without comparing pages yourself.

The feed keeps the last FEED_LENGTH syncs that changed something, newest
first, and is stored between runs like the other caches.
"""

from datetime import datetime, timezone

FEED_LENGTH = 20
XP_CHANGE_TO_REPORT = 1.0  # five-week xP; smaller moves are everyday noise
CHIP_NAMES = {"bboost": "Bench Boost", "3xc": "Triple Captain", "freehit": "Free Hit", "wildcard": "Wildcard"}


def plan_players(snapshot):
    """Every player the plan's first week buys or sells."""
    plan = snapshot.get("solverPlan")
    if not plan:
        return set()
    return {player for move in plan["weeks"][0]["moves"] for player in (move["out"], move["in"])}


def summarise(snapshot):
    """The parts of a snapshot the feed compares, small enough to store every run."""
    plan = snapshot.get("solverPlan")
    watched = set(snapshot["squad"]) | plan_players(snapshot)
    players = snapshot["players"]
    return {
        "gameweek": snapshot["gameweek"],
        "squad": sorted(snapshot["squad"]),
        "captain": snapshot["captainOptions"][0]["playerId"] if snapshot["captainOptions"] else None,
        "players": {
            str(player_id): {
                "name": players[str(player_id)]["name"],
                "windowXp": players[str(player_id)]["windowXp"],
                "price": players[str(player_id)]["price"],
                "news": players[str(player_id)]["news"],
            }
            for player_id in watched if str(player_id) in players
        },
        "firstWeekMoves": [[move["out"], move["in"]] for move in plan["weeks"][0]["moves"]] if plan else [],
        "chips": {
            card["chip"]: f'{card["decision"]["action"]} {card["decision"]["week"]}'
            for card in snapshot["chipPlan"]["cards"] if card.get("decision")
        },
    }


def describe_moves(moves, names):
    return ", ".join(f"{names.get(str(out_id), out_id)} → {names.get(str(in_id), in_id)}" for out_id, in_id in moves) or "no transfer"


def describe_chip(text):
    """"play 13" -> "play in GW13", "save 19" -> "save for GW19", "none None" -> "not needed"."""
    action, week = text.split()
    return {"play": f"play in GW{week}", "save": f"save for GW{week}"}.get(action, "not needed")


def player_changes(before, after):
    """Sentences about your players: xP moves, new injury news and price changes."""
    lines = []
    for player_id, now in after["players"].items():
        then = before["players"].get(player_id)
        if not then:
            continue
        name = now["name"]
        if now["news"] != then["news"]:
            lines.append(f"{name}: {now['news'] or 'injury news cleared'}")
        if abs(now["windowXp"] - then["windowXp"]) >= XP_CHANGE_TO_REPORT:
            lines.append(f"{name}'s five-week xP {then['windowXp']:.1f} → {now['windowXp']:.1f} ({now['windowXp'] - then['windowXp']:+.1f})")
        if now["price"] != then["price"]:
            lines.append(f"{name}'s price £{then['price'] / 10:.1f}m → £{now['price'] / 10:.1f}m")
    return lines


def plan_changes(before, after):
    """Sentences about the advice: gameweek, squad, first-week moves, chips and captain."""
    names = {**{k: v["name"] for k, v in before["players"].items()}, **{k: v["name"] for k, v in after["players"].items()}}
    lines = []
    if after["gameweek"] != before["gameweek"]:
        lines.append(f"New gameweek: now planning for GW{after['gameweek']}")
    if after["squad"] != before["squad"]:
        gone = [names.get(str(p), p) for p in before["squad"] if p not in after["squad"]]
        added = [names.get(str(p), p) for p in after["squad"] if p not in before["squad"]]
        lines.append(f"Your squad changed: {', '.join(map(str, gone))} out, {', '.join(map(str, added))} in")
    if after["firstWeekMoves"] != before["firstWeekMoves"] and after["gameweek"] == before["gameweek"]:
        lines.append(f"This week's plan is now {describe_moves(after['firstWeekMoves'], names)} (was {describe_moves(before['firstWeekMoves'], names)})")
    for chip, now in after["chips"].items():
        then = before["chips"].get(chip)
        if then and then != now:
            lines.append(f"{CHIP_NAMES[chip]}: now {describe_chip(now)} (was {describe_chip(then)})")
    if after["captain"] != before["captain"] and after["captain"]:
        lines.append(f"Captain pick is now {names.get(str(after['captain']), after['captain'])}")
    return lines


def update_feed(storage, team_id, snapshot):
    """Compares this snapshot with the last run's, adds what changed to the feed and returns the feed."""
    name = f"changes/{team_id}"
    saved = storage.load_raw(name) or {"summary": None, "feed": []}
    summary = summarise(snapshot)
    feed = saved["feed"]
    if saved["summary"]:
        lines = plan_changes(saved["summary"], summary) + player_changes(saved["summary"], summary)
        if lines:
            feed = [{"at": datetime.now(timezone.utc).isoformat(), "changes": lines}, *feed][:FEED_LENGTH]
    storage.save_raw(name, {"summary": summary, "feed": feed})
    return feed
