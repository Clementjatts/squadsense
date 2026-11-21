"""Alerts: email and phone notifications, checked at the end of every sync.

Five kinds, all about your own squad and plan:

- the deadline is within DEADLINE_WINDOW_HOURS, with this week's plan
- your players FPL expects to drop in price tonight
- new injury news on your players
- your players one yellow card from a ban
- this week's plan or a chip decision changing (from the "What changed" feed)

Each alert has a key, and keys already in `alerts_sent` are skipped, so
nothing is sent twice however often the sync runs. The very first time
alerts run, the injury and ban news that already exists is marked as
sent without sending, so you aren't flooded with old news.

Email goes through Resend (RESEND_API_KEY, ALERT_EMAIL_TO and
ALERT_EMAIL_FROM); phone and browser notifications go through web push
(VAPID_PRIVATE_KEY and VAPID_SUBJECT) to every device you turned alerts
on for. Without any of these settings, alerts are skipped with a note in
the log, so local runs never send anything.
"""

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

log = logging.getLogger("squadsense.alerts")

DEADLINE_WINDOW_HOURS = 2.5  # runs are 2 hours apart, so this catches every deadline once
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


@dataclass
class Channels:
    """Which ways of sending are set up, read from the environment."""

    resend_key: str | None = None
    email_to: str | None = None
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
        return bool(self.resend_key and self.email_to)

    def push_ready(self):
        return bool(self.vapid_private_key and self.vapid_subject)


def short_hash(text):
    return hashlib.sha1(text.encode()).hexdigest()[:10]


def name_of(snapshot, player_id):
    return snapshot["players"].get(str(player_id), {}).get("name", f"player {player_id}")


def plan_summary(snapshot):
    """This week's plan in one line: moves, chip and captain."""
    plan = snapshot.get("solverPlan")
    captain = snapshot["captainOptions"][0]["playerId"] if snapshot["captainOptions"] else None
    parts = []
    if plan:
        week = plan["weeks"][0]
        moves = ", ".join(f"{name_of(snapshot, m['out'])} → {name_of(snapshot, m['in'])}" for m in week["moves"])
        parts.append(f"Transfers: {moves or 'none, roll the free transfer'}")
        if week["chip"]:
            parts.append(f"Chip: {week['chip']}")
    if captain:
        parts.append(f"Captain: {name_of(snapshot, captain)}")
    return ". ".join(parts) + "."


def deadline_alert(snapshot, now):
    """A reminder when the deadline is less than DEADLINE_WINDOW_HOURS away."""
    deadline = datetime.fromisoformat(snapshot["deadline"].replace("Z", "+00:00"))
    hours = (deadline - now).total_seconds() / 3600
    if not 0 < hours <= DEADLINE_WINDOW_HOURS:
        return []
    when = deadline.strftime("%H:%M UTC")
    return [Alert(
        [f"deadline-{snapshot['gameweek']}"], f"GW{snapshot['gameweek']} deadline at {when}",
        f"About {hours:.1f} hours to go. {plan_summary(snapshot)} Make any changes on the FPL site.", "/plan",
    )]


def price_drop_alert(snapshot, now):
    """Your players FPL expects to fall tonight, once per player per night."""
    at_risk = [player_id for player_id in snapshot["priceWatch"]["atRisk"] if player_id in snapshot["squad"]]
    if not at_risk:
        return []
    night = now.strftime("%Y-%m-%d")
    names = ", ".join(name_of(snapshot, player_id) for player_id in at_risk)
    return [Alert(
        [f"price-{night}-{player_id}" for player_id in at_risk], "Price drop likely tonight",
        f"FPL expects these players of yours to fall £0.1m at 00:00 UK: {names}. Selling before then keeps the money.", "/prices",
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


def plan_change_alert(snapshot, run_started):
    """The plan or a chip decision changed in this run, from the "What changed" feed."""
    feed = snapshot.get("changes") or []
    if not feed or datetime.fromisoformat(feed[0]["at"]) < run_started:
        return []
    chip_words = ("Bench Boost", "Triple Captain", "Free Hit", "Wildcard")
    lines = [line for line in feed[0]["changes"] if line.startswith("This week's plan") or line.startswith(chip_words)]
    if not lines:
        return []
    return [Alert([f"plan-{short_hash(feed[0]['at'] + ''.join(lines))}"], "Your plan changed", " ".join(lines), "/plan")]


def collect(snapshot, now, run_started):
    """Every alert the snapshot calls for right now (before checking what was already sent)."""
    return (
        deadline_alert(snapshot, now) + price_drop_alert(snapshot, now) + injury_alerts(snapshot)
        + ban_alerts(snapshot) + plan_change_alert(snapshot, run_started)
    )


def send_email(channels, alert, client):
    """Sends one alert by email through Resend. Returns True if Resend accepted it.

    A failure is logged, not raised, so a mail problem never stops the sync.
    """
    try:
        response = client.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {channels.resend_key}"},
            json={"from": channels.email_from, "to": [channels.email_to], "subject": f"SquadSense: {alert.title}", "text": alert.body},
        )
    except httpx.HTTPError as error:
        log.error("Couldn't reach Resend: %s", error)
        return False
    if response.status_code >= 300:
        log.error("Resend refused the email (HTTP %s): %s", response.status_code, response.text[:200])
        return False
    return True


def send_push(channels, alert, storage, site_url):
    """Sends one alert to every subscribed device. Returns True if at least one accepted it."""
    from pywebpush import WebPushException, webpush

    delivered = False
    payload = json.dumps({"title": alert.title, "body": alert.body, "url": f"{site_url}{alert.path}" if site_url else alert.path})
    for subscription in storage.load_push_subscriptions():
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


def run_alerts(storage, snapshot, run_started, channels=None, client=None, now=None):
    """Checks every alert, sends the new ones and records them. Returns the titles sent."""
    channels = channels or Channels.from_environment()
    if not channels.email_ready() and not channels.push_ready():
        log.info("Alerts not set up (no Resend or web push settings), so nothing is sent")
        return []
    now = now or datetime.now(timezone.utc)
    first_run = not storage.alert_was_sent(PRIMED_KEY)
    client = client or httpx.Client(timeout=20)
    site_url = os.environ.get("SITE_URL", "").rstrip("/")
    sent = []
    for alert in collect(snapshot, now, run_started):
        new_keys = [key for key in alert.keys if not storage.alert_was_sent(key)]
        if not new_keys:
            continue
        if first_run and alert.silent_on_first_run:
            storage.mark_alerts_sent(new_keys)  # existing news when alerts were first switched on
            continue
        delivered = (channels.email_ready() and send_email(channels, alert, client)) | (
            channels.push_ready() and send_push(channels, alert, storage, site_url)
        )
        if delivered:
            storage.mark_alerts_sent(new_keys)
            sent.append(alert.title)
    if first_run:
        storage.mark_alerts_sent([PRIMED_KEY])
    log.info("Alerts sent: %s", ", ".join(sent) or "none")
    return sent
