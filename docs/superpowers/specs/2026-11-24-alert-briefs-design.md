# Alert briefs and email templates: design

Approved by Clement on 24 November 2026.

## Why

The sync re-plans every 2 hours and sent "Your plan changed" every time the
plan moved. Most of those moves were close calls: on 24 November the
Triple Captain was worth 6.0 to 7.0 xP in every week from GW12 to GW19, so
the chosen week flipped on tiny changes. Clement couldn't tell which
messages to act on, and the emails were one plain line from Resend's test
sender.

## Goals

- Decide once per gameweek, close to the deadline.
- Two plan emails per gameweek: a plan brief about 24 hours before the
  deadline and a final call about 2.5 hours before.
- Mark each item firm or close call, so Clement knows what is worth acting on.
- HTML emails with a plain-text copy, in the app's own colors, from a
  proper address.

## Non-goals

- Changing the chip strategy or the plan's settings (backtested; the
  close-call label already covers the flips).
- Reading what Clement already did this week. The sync runs on GitHub,
  where FPL sign-in isn't allowed.

## Anti-goals

- Sending more messages than today.
- Telling him to act early on anything that isn't price-driven.

## Alerts after the change

| Alert | When | Notes |
|---|---|---|
| Plan for GWx | First sync within 26 hours of the deadline | Transfers, captain, chips, each marked firm or close call |
| Final call | First sync within 2.5 hours of the deadline | Replaces the old deadline alert. Lists what changed since the plan brief. Wildcard and Free Hit marked "can't be undone" |
| Injury news, ban risk | As it happens | Unchanged |
| Price drop tonight | As it happens | Only for players the first-week plan sells |
| Your plan changed | Removed | The "What changed" feed stays on the Dashboard |

Firm or close call:

- A transfer is firm when at least 70% of the noisy re-solves made it the
  same week (`sameWeekShare`). A move with a `priceNote` is tagged "make now".
- The captain is a close call when the second option is within 0.5 xP.
- A chip uses the strategy's own `closeCall`.

The plan brief is saved as raw `brief/{team}/{gw}`, so the final call can
list what changed since.

## Approaches considered for the email

1. Python standard library: one shared layout and a block per alert, built
   with `html.escape` and inline styles. Chosen: no new dependencies, and
   the alert code is already Python.
2. Jinja templates in files: tidier templates, but a new dependency for a
   handful of emails.
3. React Email from the website: a second toolchain inside a Python job.

## Email layout

Navy header with the SquadSense name and the alert's title, a card of
labeled rows (label, value, tag), an optional "Changed since" note, a lime
button to the matching page, and a footer saying which sync sent it.
Tables and inline CSS, since mail apps ignore style sheets. Times are shown
in UK time. Replies go to `ALERT_EMAIL_TO`. Push messages stay one short
line.

## Sender

Clement verifies clementadegbenro.com in Resend, adds its DNS records in
Cloudflare himself, and sets the `ALERT_EMAIL_FROM` secret to
`SquadSense <alerts@clementadegbenro.com>`. Until then the test sender
keeps working.

## Left to the builder

Exact wording, spacing, and how rows are named in code.
