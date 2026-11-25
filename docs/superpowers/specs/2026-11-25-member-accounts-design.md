# Member accounts: friends and family sign themselves up

Design, 25 November 2026. Replaces part 4 ("Family teams") of
`2026-11-25-next-four-features-design.md`.

## Why

Clement wants friends and family to use SquadSense for their own FPL
teams without him collecting their details first. Each person should
sign up with their own FPL team ID and password, the way the app works
for him today, and see only their own team.

## Goals

- Anyone with the invite code can create an account: FPL team ID, name,
  email and their own password.
- Each person signs in with their email and password and sees only their
  team: dashboard, plan, leagues, review, Done on FPL marks, drafts,
  watchlist, calendar and alerts.
- A new member's team is ready about 5 minutes after signing up.
- Everyone can reset a forgotten password themselves.
- Stays on free plans.

## Non-goals

- Proving someone owns the FPL team they enter. Everything shown is public
  FPL data, so a wrong ID is harmless.
- Apply to FPL for members. It stays Clement's only, on his Mac.
- A members admin page. Clement removes someone in Supabase's table editor
  (one switch); a page can come later if needed.

## Anti-goals

- Strangers using up the free email allowance or slowing the syncs.
- Any member seeing another member's team, marks, drafts or watchlist.
- Pages getting slower for Clement.

## Approaches

1. **Supabase Auth for accounts, plus the site's own signed cookie.**
   Chosen. Supabase stores passwords safely, handles sign-up and sends
   password-reset emails, and it's free up to 50,000 users. After a
   successful sign-in, the site sets its own signed cookie (as it does
   today, now holding the member's user id and team id), so every page
   checks the cookie locally with no extra request: pages stay as fast
   as now.
2. Supabase Auth sessions end to end (its cookies and refresh tokens on
   every request). Rejected: every page would check the session with
   Supabase, adding a request per page, and more moving parts.
3. Our own password table. Rejected: we'd own password storage and reset
   emails, which Supabase already does well.

## The design

### Accounts and the invite code

- Sign-up page `/signup`:
  - invite code
  - FPL team ID, looked up on FPL so the form shows "Team: X, manager Y"
    before it's confirmed
  - name, email and password (at least 10 characters)
- The invite code is a Vercel setting, `INVITE_CODE`. Changing it stops
  new sign-ups with the old code; existing members are unaffected.
- `MAX_MEMBERS` (20) caps sign-ups, to stay inside the free email allowance.
- No email confirmation step: the invite code is the gate. Password
  reset emails go through Resend (Supabase's custom SMTP setting), from
  `SquadSense <alerts@clementadegbenro.com>`, so they look like the
  other alerts and avoid Supabase's limit of a few emails an hour.
- Sign-in page `/login`: email and password, plus "Forgot password". The
  shared `SITE_PASSWORD` is retired once Clement's own account works.
- Table `members`:
  - `user_id`, the Supabase Auth user
  - `team_id`, unique: one account per FPL team
  - `name` and `email`
  - `role`: "owner" for Clement, "member" for everyone else
  - `active`: set it off to remove someone
  - `created_at`
  - Row level security on; only the server key reads it.
- Clement signs up like anyone else, then is made the owner.

### The website

- `proxy.ts` checks the signed cookie, now `user id . team id . expiry .
  signature`, and lets `/signup`, `/login` and the reset pages through.
- Every server read that uses `FPL_TEAM_ID` today uses the signed-in
  team instead:
  - pages: `lib/snapshot.ts` and the `page_snapshots` view, per team
  - `made_moves`, `planner_drafts` and `watchlist`
  - `/api/live`
  - the calendar feed: its token is made from the member's user id, so
    each person has their own link
- Nothing in the browser picks the team, so one member can't ask for
  another's data.
- Until a new member's first sync finishes, their pages show "Setting up
  your team: about 5 minutes" in place of an error.
- Apply to FPL only shows for the owner, and only on localhost, as now.
- The bell menu shows the signed-in name and a sign-out button. Push
  subscriptions are saved with the member's team id.

### The sync

- The teams to sync come from `members` where `active` is on, owner
  first. `FPL_TEAM_ID` remains a fallback for local runs.
- Shared work runs once per sync: FPL data, player histories, odds, FPL's
  rules and the model. Each team then gets its own squad, plan, leagues,
  review, snapshot and alerts.
- One team failing (FPL error, hidden squad) is logged and skipped. The
  others carry on, and the run still fails at the end so GitHub shows it.
- Alerts:
  - Each team's emails go to that member's email address.
  - Push goes to the push subscriptions saved for that team.
  - Alert keys in `alerts_sent` gain the team id, so one member's
    "brief-12" doesn't block another's.
- Signing up starts a sync straight away (`start_sync`, as Done on FPL does).
- The log notes how long each team took.
- The `api_cache` clean-up from the earlier design runs on the nightly
  full sync, so the database stays small as teams are added.
- The watchdog is unchanged: it watches that syncs run at all, and only
  emails Clement.

### Limits, written into the README

- Resend free plan: 100 emails a day. A member gets about two plan emails
  a gameweek plus the occasional alert, so 20 members fit.
- Each member's team runs in its own GitHub run at the same time as the
  others (see "Clement's answer" below), so adding members doesn't make
  Clement's sync slower.

## Calls made after the builder check

These came up when the design was read as a builder would. Each is my
call, for Clement to check:

1. **Removing someone works within a day.** The cookie still lasts 30
   days, but it records when it was issued. Once it's over 24 hours old,
   the next page checks `members.active` once and renews the cookie. So
   there's at most one extra request a day per person, pages stay as
   fast, and a removed member is out within 24 hours.
2. **A new member's first sync runs on its own.** `start_sync` and the
   workflow take an optional team id. A run for one team skips the
   shared downloads (it reads player histories and FPL's data saved by
   the last full run) and has its own concurrency group, so it doesn't
   wait behind a long regular sync. The same applies to a member's Done
   on FPL marks. Two runs can write at once because every per-team row
   carries the team id, and shared cache rows are only rewritten whole.
3. **Clement's Mac keeps a fallback.** When Supabase isn't set up (a
   local copy without its settings), sign-in falls back to
   `SITE_PASSWORD` for the owner, as today, so Apply to FPL never locks
   him out.
4. **Who gets which alert.** Members get their own plan brief, final
   call, price drops, injury and ban news, and watched-player rises.
   "FPL changed its rules" and the watchdog stay Clement's only. Each
   member can switch emails off in the bell menu (`members.emails`), and
   every email's footer says how. The 20-member limit already allows for
   password-reset emails and the watchdog.
5. **Clement's calendar link keeps working.** The owner's calendar
   still accepts today's token, so his subscription doesn't break.
   Members get links made from their own user id.

## Clement's answer: members get the same league analysis

Every member gets the same leagues as Clement: every rival read in
leagues of up to 100 teams, the sample in bigger ones (25 November 2026).
With 20 members, one run doing every team after a deadline could take
hours, so the sync fans out from day one:

- The regular run does the shared work (FPL data, player histories,
  odds, the model) and Clement's team, then starts one run per member
  through the workflow dispatch API, each with its team id (call 2).
- Each member's run happens on its own GitHub runner at the same time as
  the others. Public repositories can run 20 at once, each keeping to one
  FPL request a second, so the first sync after a deadline takes about as
  long for everyone as it does for Clement today (about 20 minutes).
- Each member uses the `SQUADSENSE_LEAGUES` rule as Clement does: every
  private league they're in, unless they choose some later (not part of
  this design).
- The watchdog still checks only that the regular runs happen.

## Left to the builder

The page layouts (following the broadcast design), exact wording, how
the sign-up form shows the looked-up team, and the order of migration
steps, as long as Clement can sign in throughout.
