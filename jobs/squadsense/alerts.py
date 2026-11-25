"""Alerts: email and phone notifications, checked at the end of every sync.

What they cover, mostly your own squad and plan:

- the plan brief, once, within BRIEF_WINDOW_HOURS of the deadline
- the final call, once, within DEADLINE_WINDOW_HOURS, with what changed since the brief
- players the plan sells this week that FPL expects to drop in price tonight
- players on your watchlist (not in your squad) that FPL expects to rise tonight
- new injury news on your players
- your players one yellow card from a ban
- FPL changing a scoring or squad rule (from rules.apply_fpl_settings)
- a move marked "Done on FPL" that isn't in the real squad after the deadline

The plan is re-solved every sync and close calls flip often, so plan
changes are only reported in the two briefs, never on their own.

Every team (the owner's and each member's) gets its own alerts. "FPL
changed its rules" goes to the owner only.

Each alert has a key, stored as "{team id}:{key}", and keys already in
`alerts_sent` are skipped, so nothing is sent twice however often the
sync runs, and one team's alert never blocks another's. The very first
time alerts run for a team, the injury and ban news that already exists
is marked as sent without sending, so a new member isn't flooded with
old news.

Email goes through Resend (RESEND_API_KEY and ALERT_EMAIL_FROM) to the
member's own address, unless they switched emails off in the bell menu
(`members.emails`). Replies go to ALERT_EMAIL_TO, the owner's address.
Phone and browser notifications go through web push (VAPID_PRIVATE_KEY
and VAPID_SUBJECT) to the devices that turned alerts on for that team.
Without any of these settings, alerts are skipped with a note in the
log, so local runs never send anything.
"""

import hashlib
import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from . import briefs
from .email_template import render_email
from .price_watch import price_day, rises_tonight

log = logging.getLogger("squadsense.alerts")

DEADLINE_WINDOW_HOURS = 2.5  # final call; runs are 2 hours apart, so this catches every deadline once
BRIEF_WINDOW_HOURS = 26  # plan brief: the first run within about a day of the deadline
RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "SquadSense <onboarding@resend.dev>"  # Resend's test sender, until your domain is verified
PRIMED_KEY = "alerts-primed"


@dataclass
class Alert:
    """One message to send. `keys` are marked as sent once it goes out."""

    keys: list
    title: str
    body: str
    path: str = "/"  # the page a notification opens
    silent_on_first_run: bool = False  # old news to record, not send, the first time alerts run
    rows: list = field(default_factory=list)  # briefs.Row lines, shown as a table in the email
    intro: str | None = None  # the email's opening sentence; `body` is used when there is none
    note: str | None = None  # a highlighted line under the rows, like what changed since the brief
    after_send: Callable[[], None] | None = None  # runs once the alert has gone out


@dataclass
class Channels:
    """Which ways of sending are set up, read from the environment."""

    resend_key: str | None = None
    email_to: str | None = None  # the owner's address: replies go here, and so does the test alert
    email_from: str = DEFAULT_FROM
    vapid_private_key: str | None = None
    vapid_subject: str | None = None

    @classmethod
    def from_environment(cls):
        return cls(
            resend_key=os.environ.get("RESEND_API_KEY") or None,
            email_to=os.environ.get("ALERT_EMAIL_TO") or None,
            email_from=os.environ.get("ALERT_EMAIL_FROM") or DEFAULT_FROM,
            vapid_private_key=os.environ.get("VAPID_PRIVATE_KEY") or None,
            vapid_subject=os.environ.get("VAPID_SUBJECT") or None,
        )

    def email_ready(self):
        """True when Resend is set up; each team's own address comes from its member row."""
        return bool(self.resend_key)

    def push_ready(self):
        return bool(self.vapid_private_key and self.vapid_subject)


def short_hash(text):
    return hashlib.sha1(text.encode()).hexdigest()[:10]


def name_of(snapshot, player_id):
    return snapshot["players"].get(str(player_id), {}).get("name", f"player {player_id}")


def team_id(snapshot):
    """The snapshot's team id, or 0 when it has none (test data)."""
    return (snapshot.get("team") or {}).get("id", 0)


def brief_name(snapshot):
    """Where the plan brief is saved, so the final call can compare against it."""
    return f"brief/{team_id(snapshot)}/{snapshot['gameweek']}"


def hours_to_deadline(snapshot, now):
    """Hours until this gameweek's deadline (negative once it has passed)."""
    deadline = datetime.fromisoformat(snapshot["deadline"].replace("Z", "+00:00"))
    return (deadline - now).total_seconds() / 3600


def push_line(rows):
    """The brief squeezed into one line for a phone notification."""
    return " ".join(f"{row.label}: {row.value.rstrip('.')}." for row in rows)


def plan_brief_alert(snapshot, now, storage):
    """The plan about a day before the deadline. Saves what it said once sent."""
    hours = hours_to_deadline(snapshot, now)
    if not DEADLINE_WINDOW_HOURS < hours <= BRIEF_WINDOW_HOURS:
        return []
    rows = briefs.plan_rows(snapshot)
    summary = briefs.brief_summary(snapshot)
    return [Alert(
        [f"brief-{snapshot['gameweek']}"], f"Plan for GW{snapshot['gameweek']}", push_line(rows), "/plan",
        rows=rows, intro=f"Deadline {briefs.uk_time(snapshot['deadline'])}. Nothing here needs doing yet, "
                         "unless it's marked MAKE NOW. The final call comes about 2.5 hours before the deadline. "
                         "Already made a move? Mark it done in the app.",
        after_send=lambda: storage.save_raw(brief_name(snapshot), summary),
    )]


def final_call_alert(snapshot, now, storage):
    """The plan to act on, about 2.5 hours before the deadline, with what changed since the brief."""
    hours = hours_to_deadline(snapshot, now)
    if not 0 < hours <= DEADLINE_WINDOW_HOURS:
        return []
    rows = briefs.plan_rows(snapshot)
    changes = briefs.changes_since(storage.load_raw(brief_name(snapshot)), snapshot)
    return [Alert(
        [f"final-{snapshot['gameweek']}"], f"GW{snapshot['gameweek']} final call: deadline {briefs.uk_time(snapshot['deadline'])}",
        push_line(rows), "/plan", rows=rows,
        intro=f"About {hours:.1f} hours to go. This is the plan to act on. Make the changes on the FPL site.",
        note=f"Changed since the plan brief: {'; '.join(changes)}." if changes else None,
    )]


def price_drop_alert(snapshot, now):
    """Players the plan sells this week that FPL expects to fall tonight, once per player per night.

    Players you're keeping aren't included: their fall only matters if
    you sell them later, and the brief already covers this week's plan.
    """
    week = briefs.first_week(snapshot)
    selling = {move["out"] for move in week["moves"]} if week else set()
    at_risk = [player_id for player_id in snapshot["priceWatch"]["atRisk"] if player_id in selling]
    if not at_risk:
        return []
    night = now.strftime("%Y-%m-%d")
    names = ", ".join(name_of(snapshot, player_id) for player_id in at_risk)
    return [Alert(
        [f"price-{night}-{player_id}" for player_id in at_risk], "Price drop likely tonight",
        f"The plan sells {names} this week, and FPL expects a £0.1m fall at 00:00 UK. Selling before then keeps the money.", "/prices",
    )]


def watch_rise_alert(snapshot, now, watched_ids):
    """Watched players you don't own that FPL expects to rise at 00:00 UK, once per player per night.

    Uses the same rule as the website's TONIGHT tag (price_watch.rises_tonight).
    """
    watched = set(watched_ids) - set(snapshot["squad"])
    if not watched:
        return []
    rising = [row["id"] for row in snapshot["priceWatch"]["players"] if row["id"] in watched and rises_tonight(row)]
    if not rising:
        return []
    night = price_day(now)
    names = ", ".join(name_of(snapshot, player_id) for player_id in rising)
    return [Alert(
        [f"watch-{night}-{player_id}" for player_id in rising], "Watched player likely to rise tonight",
        f"FPL expects {names} from your watchlist to rise £0.1m at 00:00 UK. Buying before then avoids the rise.", "/prices",
    )]


def injury_alerts(snapshot):
    """One alert per new piece of injury or availability news on your players."""
    alerts = []
    for player_id in snapshot["squad"]:
        player = snapshot["players"].get(str(player_id), {})
        if player.get("news"):
            alerts.append(Alert(
                [f"news-{player_id}-{short_hash(player['news'])}"], f"{player['name']}: injury news", player["news"], "/",
                silent_on_first_run=True,
            ))
    return alerts


def ban_alerts(snapshot):
    """Your players one booking away from a suspension, once per yellow-card count."""
    alerts = []
    for flag in snapshot["flags"]:
        if flag["kind"] == "suspension":
            player = snapshot["players"].get(str(flag["playerId"]), {})
            alerts.append(Alert(
                [f"ban-{flag['playerId']}-{player.get('yellowCards')}"], f"{player.get('name', 'A player')}: ban risk", flag["message"], "/",
                silent_on_first_run=True,
            ))
    return alerts


def rule_change_alert(snapshot):
    """One alert when FPL's published rules differ from the typed-in ones, once per set of differences."""
    differences = snapshot.get("ruleChanges") or []
    if not differences:
        return []
    return [Alert(
        [f"rules-{short_hash('; '.join(differences))}"], "FPL changed its rules",
        f"{'; '.join(differences)}. SquadSense now uses FPL's values. The website's Planner keeps its own "
        "copy of the squad rules in web/lib/planning.ts, so check those still match.", "/",
    )]


def made_move_mismatch_alert(snapshot):
    """One alert per marked move that FPL's real squad doesn't have, once the deadline has passed."""
    return [Alert(
        [f"made-mismatch-{move['gameweek']}-{move['out']}"], "A move you marked isn't in your FPL team",
        f"You marked {name_of(snapshot, move['out'])} → {name_of(snapshot, move['in'])} as done for GW{move['gameweek']}, "
        "but FPL's squad doesn't have it. SquadSense now plans from your real FPL squad.", "/",
    ) for move in snapshot.get("madeMoveMismatches") or []]


def collect(snapshot, now, storage, is_owner):
    """Every alert the snapshot calls for right now (before checking what was already sent).

    The rules alert is about the app itself, so only the owner gets it.
    """
    return (
        plan_brief_alert(snapshot, now, storage) + final_call_alert(snapshot, now, storage)
        + price_drop_alert(snapshot, now) + watch_rise_alert(snapshot, now, storage.load_watchlist(team_id(snapshot)))
        + injury_alerts(snapshot) + ban_alerts(snapshot)
        + (rule_change_alert(snapshot) if is_owner else []) + made_move_mismatch_alert(snapshot)
    )


def send_email(channels, alert, client, site_url, sent_at, to):
    """Sends one alert by email through Resend to `to`, as HTML with a plain-text copy.

    Replies go to the owner's address (or `to` when none is set). Returns
    True if Resend accepted it. A failure is logged, not raised, so a mail
    problem never stops the sync.
    """
    html, text = render_email(alert, site_url, sent_at)
    try:
        response = client.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {channels.resend_key}"},
            json={"from": channels.email_from, "to": [to], "reply_to": channels.email_to or to,
                  "subject": f"SquadSense: {alert.title}", "html": html, "text": text},
        )
    except httpx.HTTPError as error:
        log.error("Couldn't reach Resend: %s", error)
        return False
    if response.status_code >= 300:
        log.error("Resend refused the email (HTTP %s): %s", response.status_code, response.text[:200])
        return False
    return True


def send_push(channels, alert, storage, site_url, team):
    """Sends one alert to every device subscribed for `team` (every device when it's None).

    Returns True if at least one device accepted it.
    """
    from pywebpush import WebPushException, webpush

    delivered = False
    payload = json.dumps({"title": alert.title, "body": alert.body, "url": f"{site_url}{alert.path}" if site_url else alert.path})
    for subscription in storage.load_push_subscriptions(team):
        try:
            webpush(subscription, payload, vapid_private_key=channels.vapid_private_key, vapid_claims={"sub": channels.vapid_subject})
            delivered = True
        except WebPushException as error:
            status = error.response.status_code if error.response is not None else None
            if status in (404, 410):
                # The device turned notifications off or the subscription expired.
                storage.delete_push_subscription(subscription["endpoint"])
                log.info("Removed an expired push subscription")
            else:
                log.error("Push notification failed (HTTP %s): %s", status, error)
    return delivered


def team_key(team, key):
    """An alert key as stored in `alerts_sent`: the team id, a colon, then the key ("11304359:brief-12")."""
    return f"{team}:{key}"


def email_address(channels, member):
    """Where this member's alert emails go, or None when Resend isn't set up or they switched emails off."""
    if channels.email_ready() and member.get("emails") and member.get("email"):
        return member["email"]
    return None


def run_alerts(storage, snapshot, member, channels=None, client=None, now=None):
    """Checks every alert for one member's team, sends the new ones and records them. Returns the titles sent.

    `member` is a row from storage.load_members(): its team id keys the
    alerts and picks the push devices, and its email and `emails` switch
    decide whether email goes out.
    """
    channels = channels or Channels.from_environment()
    team = member["teamId"]
    to = email_address(channels, member)
    if not to and not channels.push_ready():
        log.info("Team %d: no alert email address or web push settings, so nothing is sent", team)
        return []
    now = now or datetime.now(timezone.utc)
    first_run = not storage.alert_was_sent(team_key(team, PRIMED_KEY))
    client = client or httpx.Client(timeout=20)
    site_url = os.environ.get("SITE_URL", "").rstrip("/")
    sent = []
    for alert in collect(snapshot, now, storage, member["role"] == "owner"):
        new_keys = [team_key(team, key) for key in alert.keys if not storage.alert_was_sent(team_key(team, key))]
        if not new_keys:
            continue
        if first_run and alert.silent_on_first_run:
            storage.mark_alerts_sent(new_keys)  # existing news when alerts were first switched on
            continue
        delivered = (bool(to) and send_email(channels, alert, client, site_url, now, to)) | (
            channels.push_ready() and send_push(channels, alert, storage, site_url, team)
        )
        if delivered:
            storage.mark_alerts_sent(new_keys)
            if alert.after_send:
                alert.after_send()
            sent.append(alert.title)
    if first_run:
        storage.mark_alerts_sent([team_key(team, PRIMED_KEY)])
    log.info("Team %d alerts sent: %s", team, ", ".join(sent) or "none")
    return sent


def owner_team_id(storage):
    """The owner's team id from storage.load_members(), or None when no owner is known."""
    return next((member["teamId"] for member in storage.load_members() if member["role"] == "owner"), None)


def send_test_alert(storage, channels=None, client=None):
    """Sends one test message by email and push, to check the settings work.

    Email goes to ALERT_EMAIL_TO and push to the owner's devices, so
    members never get it. Uses the same send functions as real alerts but
    records nothing, so it can be run any number of times. Returns
    {"email": ..., "push": ...}, each True (accepted), False (failed,
    reason in the log) or None (not set up).
    """
    channels = channels or Channels.from_environment()
    client = client or httpx.Client(timeout=20)
    site_url = os.environ.get("SITE_URL", "").rstrip("/")
    owner = owner_team_id(storage)
    alert = Alert([], "Test alert", "Alerts are working. Real ones arrive like this one.", "/")
    email_on = channels.email_ready() and channels.email_to
    results = {
        "email": send_email(channels, alert, client, site_url, datetime.now(timezone.utc), channels.email_to) if email_on else None,
        "push": send_push(channels, alert, storage, site_url, owner) if channels.push_ready() else None,
    }
    if channels.push_ready() and not results["push"] and not storage.load_push_subscriptions(owner):
        log.warning("No devices have alerts turned on yet: tap the bell on the website first")
    return results


def main():
    """Command line: `python -m squadsense.alerts --test` sends a test alert."""
    import argparse

    from .sync import choose_storage

    parser = argparse.ArgumentParser(description="Send a test alert by email and push.")
    parser.add_argument("--test", action="store_true", required=True, help="Send one test message")
    parser.add_argument("--local-folder", default=".data", help="Folder for local runs without Postgres")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    results = send_test_alert(choose_storage(args.local_folder))
    log.info("Test alert: email %s, push %s", *(describe_result(results[way]) for way in ("email", "push")))
    if not any(results.values()):
        raise SystemExit("The test alert didn't reach anyone. See the messages above.")


def describe_result(result):
    """True/False/None as words for the log."""
    return {True: "sent", False: "failed", None: "not set up"}[result]


if __name__ == "__main__":
    main()
