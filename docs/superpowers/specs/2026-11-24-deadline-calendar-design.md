# Deadline calendar feed: design

Short design, 24 November 2026.

## Why

Clement makes every FPL change himself, relying on the final call alert.
That alert comes from the GitHub sync, which can run late or not at all.
A calendar on his iPhone that reminds him before every deadline is a
backup that doesn't depend on GitHub.

## Goals

- One private calendar link, added once, listing every gameweek deadline
  left this season.
- A reminder 2 hours before each deadline and another 30 minutes before.
- Keeps working when the sync doesn't run: the website reads deadlines
  straight from FPL.

## Non-goals and anti-goals

- No plan details in the calendar (transfers, captain). The emails cover those.
- No new secret to set up, and no GitHub minutes used.
- Must not open the rest of the site without the password.

## Approaches

1. Subscribed calendar feed served by the website. Chosen: set up once,
   independent of GitHub.
2. A `.ics` invite attached to each plan brief email: simpler, but it
   needs the sync to have run and a tap every week.

## The design

- `GET /api/calendar/<token>` returns an iCalendar file. `proxy.ts` lets
  `/api/calendar/` through without the cookie; the route itself checks the token.
- The token is an HMAC of the text "calendar-feed" made with `SITE_SECRET`
  (the first 32 hex characters), so no new setting is needed. A wrong or
  missing token gets a 404.
- Deadlines come from FPL's `bootstrap-static` events, cached for an hour.
  Every gameweek whose deadline hasn't passed gets one event, "FPL GW12
  deadline", from 2 hours before the deadline to the deadline, with
  alarms at its start and 90 minutes in. The description links to `/plan`.
- Each event's UID is fixed per gameweek, so a deadline FPL moves updates
  in place. Times are written in UTC; the phone shows them in local time.
- A pure builder in `web/lib/calendar.ts`, tested in
  `web/tests/calendar.test.mts` and added to `npm test`.
- The bell menu (`AccountMenu.tsx`) gets "Add deadlines to your calendar",
  a `webcal://` link it reads from a new signed-in route, `/api/calendar-link`.

## Left to the builder

Exact wording, how lines are folded and escaped (per RFC 5545), and the menu styling.

## Known limits

- iPhone Calendar refreshes subscribed calendars on its own schedule
  (about hourly at best), so a short-notice deadline change can show late.
- Google Calendar ignores alarms in subscribed calendars. iPhone Calendar
  should keep them (about 75% sure); checked once Clement subscribes.
