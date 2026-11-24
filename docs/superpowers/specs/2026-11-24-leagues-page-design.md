# Leagues page: pages, the same cards for every league, and where you stand

Design, 24 November 2026. Clement chose the full version.

## Why

Leagues over 100 teams scroll endlessly (up to 100 rows) and show only a
note beside the table, while smaller leagues get threats, differentials
and captains. The page feels empty for the big ones. Now that the
repository is public, GitHub Actions minutes are free and unlimited, so
reading more rivals is affordable.

## Goals

- Tables show 20 teams a page, with Previous, Next and "Jump to me".
- Every league shows the same cards: threats, differentials, captains.
- Every league shows "Where you stand": rank and the points gap to the
  leader, the team above and the team below.

## Non-goals

- Chip histories for big-league rivals (the Chip Planner's rival card
  stays small leagues only).
- Reading every rival of a big league.

## The design

**Sync (`jobs/squadsense/leagues.py`).**
- For leagues over 100 teams, read the picks of a sample: the top
  `SAMPLE_TOP` (10) and the `SAMPLE_AROUND` (10) teams just above and just
  below you, by rank, from the saved table. Picks are cached per team and
  gameweek, so they're read once per deadline (about 30 per league).
- Each summary gains `picksFrom`: "all" or "sample", so the page can say
  whose picks the cards come from.
- Each summary gains `standing`: `{leaderGap, above: {teamName, gap},
  below: {teamName, gap}}` from the table (null parts at the top or bottom).
  For big leagues, the team above and below come from the rows around you.

**Website (`LeaguesView.tsx`, new `lib/leagueTable.ts`).**
- Pure helpers: `pageCount`, `pageRows`, `pageWithEntry`, and `rankGaps`
  (where a big league's table jumps from the top 50 to the rows around
  you, shown as a "ranks 51 to 205 not shown" line). Tested in
  `tests/leagueTable.test.mts`.
- The table opens on the page with your row. Previous and Next sit under
  it with "Page 2 of 5"; "Jump to me" returns to your page.
- The right column: "Where you stand", then the three cards for every
  league, headed "Among all 37 rivals" or "Among the top 10 and the 20
  teams around you".

## Calls made by the builder

20 rows a page; the sample sizes; no chip histories for the sample (keeps
it to one request per rival).
