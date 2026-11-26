# Four small fixes

From an outside review of SquadSense, checked against the code and the live
database on 26 November 2026. Clement picked these four.

## 1. Mark any transfer "Done on FPL"

Why: only the plan's own first-week moves can be marked today. A transfer
Clement makes that the plan didn't suggest leaves the app planning from the
old squad until the deadline.

- The Planner's move list gets the same "Done on FPL" button beside Undo, for
  the coming gameweek only (the week the sync plans from).
- `/api/made-moves` stops requiring the move to be in the plan. A new pure
  function, `madeMoveProblem` in `web/lib/madeMoveRules.ts`, checks the move
  against the squad the last sync saw, plus any marks saved since that the
  snapshot doesn't include yet: the player out is in the squad, the player
  in isn't, both play the same position, no more than 3 from one club, and
  the bank plus the selling price covers the new player's price. It returns
  a plain sentence when the move doesn't fit, or null.
- The sync's own check (`squad_state.mark_fits`) also requires the same
  position, since the table can now hold any move.
- Approaches: checking in the browser only (rejected: the server must not
  trust it) or checking in the sync only (rejected: a bad mark would be
  saved and then silently skipped).

## 2. A cooldown on password reset emails

Why: anyone can ask for reset emails for a real account again and again.
That would use up Resend's free 100 emails a day, which the deadline alerts
need too.

- `send_reset_email` in Postgres records each email it sends (new table
  `reset_emails`) and sends nothing when that address got one in the last
  10 minutes, or when 20 have gone out in the last 24 hours.
- The page still says "a reset link is on its way" either way, so it never
  reveals whether an account exists or a limit was hit.
- Applied through the Supabase connector; `db/member-accounts.sql` gets the
  same SQL.

## 3. Tests on every push

Why: nothing checks that the Python and website copies of the rules and the
snapshot's shape still agree unless the tests are run by hand.

- New workflow `.github/workflows/ci.yml` on every push and pull request to
  `main`, with two jobs side by side: the full Python suite (about 9
  minutes; the repo is public, so minutes are free) and the website's
  `npm test` plus `npm run typecheck`. No secrets are used.
- The manual test option in `sync.yml` stays for running tests on demand.

## 4. Fresh price notes before midnight

Already done. Every sync that reuses a saved plan redoes its "buy now /
sell now" notes from the latest predictions (`strategy.refresh_price_notes`).
CLAUDE.md wrongly says the notes can be 12 hours old; that line is fixed.

## Not in scope

The other review items (storage changes, admin page, alerts page, price
overrides, model changes) stay for later; the database is 23 MB of 500 MB
with one member.
