# "Done on FPL": telling the app about transfers already made

Design, 24 November 2026.

## Why

Clement makes his transfers himself on the FPL site. FPL hides them from
public data until the deadline (checked 24 November: his transfer list was
empty after making a GW12 move), so the app keeps planning from the old
squad and keeps suggesting a move he has already made. Signing in to read
them was ruled out to protect his account.

## Goals

- One tap on a planned move says "I've made this on FPL".
- From then on, the plan, the Dashboard, the Planner and the emails start
  from the squad after that move, and stop suggesting it.
- After the deadline, FPL's real squad wins: a marked move that didn't
  happen is reported once.

## Non-goals and anti-goals

- No FPL sign-in.
- Not a way to enter arbitrary transfers: only moves the plan suggested for
  the coming gameweek can be marked.
- Never let a mark outlive its gameweek.

## Approaches

1. A button on each of the coming week's planned moves, saved in Supabase,
   applied by the sync. Chosen.
2. A form to type any transfer: covers moves the plan didn't suggest, but
   more to build and easier to get wrong. Left for later if needed.

## The design

**Storage.** New table `made_moves`: `team_id`, `gameweek`, `player_out`,
`player_in`, `price_in` (tenths of a million, the price shown when marked),
`made_at`; primary key `(team_id, gameweek, player_out)`. Row level
security on, server key only, like `planner_drafts`.

**Website.**
- `/api/made-moves`: GET lists the coming gameweek's marks, POST
  `{gameweek, out, in, priceIn}` adds one, DELETE `{gameweek, out}` undoes one.
  Signed in only. POST and DELETE then ask Supabase to start a sync
  (`start_sync`, granted to the server key), so the plan catches up in about
  5 minutes instead of up to 2 hours.
- A "Done on FPL" button next to each first-week move on the Plan page and in
  the Dashboard's "This week" card. Once marked, the move shows "Made on FPL"
  with an Undo link until the sync has run, and then appears in an "Already
  made" line.

**Sync.** After rebuilding the squad from public data, load the marks for the
coming gameweek and apply each one whose player out is in the squad and
player in isn't: swap the players, bank plus the out player's selling price
minus `price_in`, purchase price of the new player `price_in`, free transfers
down by one (not below 0). A mark that doesn't fit is skipped with a warning.
The snapshot carries `madeMoves` (the marks applied), so pages can show them.

**After the deadline.** When the marked gameweek's picks become public, the
sync checks each mark against them. A move that isn't in the real squad sends
one alert, "A move you marked isn't in your FPL team", and the real squad is
used as always.

**Emails.** The plan brief and final call list marked moves as
"Transfer: X → Y" tagged DONE, and the brief's intro adds "Already made a
move? Mark it done in the app."

## Left to the builder

Exact wording, button styling (following the broadcast design), and where the
"Already made" line sits on each page.

## Known limits

- Marks only change the plan after the next sync (about 5 minutes).
- Moves the plan didn't suggest can't be marked.
- If a price changed between the FPL transfer and the tap, the bank can be
  £0.1m off until the deadline.
