# Deadline calendar feed: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private iCalendar feed of every remaining FPL deadline, with two reminders each, served by the website.

**Architecture:** A pure builder (`web/lib/calendar.ts`) turns FPL events into an iCalendar file and makes the feed token. A route serves it to anyone with the token; `proxy.ts` lets that path through. The bell menu shows the link.

**Tech Stack:** Next.js 16 route handlers, Web Crypto HMAC, Node's built-in test runner style (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-24-deadline-calendar-design.md`

## Global Constraints

- Token: HMAC-SHA256 of `calendar-feed` with `SITE_SECRET`, first 32 hex characters. Wrong or missing token: 404.
- Event per gameweek with a future deadline: summary `FPL GW{n} deadline`, start deadline minus 2 hours, end at the deadline, alarms at `PT0S` and `PT90M` after start.
- UID `squadsense-deadline-gw{n}@squadsense`. Times in UTC (`YYYYMMDDTHHMMSSZ`). CRLF line ends, lines folded at 75 octets, text escaped per RFC 5545.
- FPL `bootstrap-static/` fetched with a one-hour revalidate.
- No em dashes; comments pass `checker.py`.

## Review Focus

- Season over (no future deadlines): a valid calendar with no events, not an error.
- `SITE_SECRET` missing: the feed answers 404 and the link route says the feed isn't set up.
- FPL down: 502, so the phone keeps its last copy.
- Commas or semicolons in text are escaped.
- Long description lines are folded.

---

### Task 1: Builder (`web/lib/calendar.ts`, `web/tests/calendar.test.mts`)

**Produces:** `deadlineCalendar(events: { id: number; deadline_time: string }[], siteUrl: string, now: Date): string`; `calendarToken(secret: string): Promise<string>`; `escapeText(text: string): string`; `foldLine(line: string): string`.

- [ ] Tests: past deadlines skipped; event times and UID right; two alarms; CRLF; escaped commas; long lines folded to 75; empty season gives VCALENDAR with no VEVENT; token is 32 hex characters and stable.
- [ ] Watch them fail, implement, add the file to `npm test`, watch them pass.

### Task 2: Route, proxy and menu

- [ ] `web/app/api/calendar/[token]/route.ts`: checks the token, fetches events, returns `text/calendar; charset=utf-8`.
- [ ] `web/proxy.ts`: paths starting `/api/calendar/` pass without the cookie.
- [ ] `web/app/api/calendar-link/route.ts` (signed in): `{ url }` as `webcal://host/api/calendar/<token>`.
- [ ] `AccountMenu.tsx`: "Add deadlines to your calendar" link; fix the alert wording ("plan changes" became "plan briefs").
- [ ] `npm run build`, then check the feed and menu in the browser on the dev server.

### Task 3: Docs and checks

- [ ] README and CLAUDE.md lines; `checker.py` on changed files; full `npm test`.
