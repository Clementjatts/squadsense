# A rival's team from the league table

Approved by Clement on 26 November 2026.

## Why

On the Leagues page he wants to click a team, such as his friend's Amda FC,
and see its whole team; the table only shows its captain and chip.

## Approaches

- Fetch on demand (chosen): clicking a name asks FPL for that one team
  through `/api/teams/[entry]`, cached for an hour (live points for a
  minute). Works for every row of every league, big ones included, and adds
  nothing to the saved snapshot.
- Store every rival's team in the sync's snapshot (rejected): only the
  fully read leagues would have them, and every page would get heavier.

## What gets built

- Team names in the league table become buttons. Clicking one slides in a
  panel (the player panel's shell, wider so a full back line fits).
- The panel shows the team name and manager, league rank, total points, the
  week's points, team value and bank, the chip played and chips left (where
  the league table has them).
- Their pitch on the shared `BroadcastPitch`: starting eleven, bench,
  captain and vice-captain, each tag showing the points he scored for them
  (captains doubled or tripled), bench players their own points. Players
  Clement owns too glow lime. Clicking a player opens his player panel.
- The week shown is the team's latest one on FPL (`current_event`). Before
  a deadline that's the previous week, which the panel says, since FPL
  hides new picks until the deadline.
- Player names, clubs and positions come from the snapshot's live picks
  table, which lists every player; `lib/rivalTeam.ts` turns FPL's picks into
  the pitch, with tests.

## Not in scope

Comparing two teams side by side.
