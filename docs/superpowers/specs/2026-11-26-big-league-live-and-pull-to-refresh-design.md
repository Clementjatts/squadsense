# Live effective ownership for big leagues, and pull to refresh

Asked for by Clement on 26 November 2026; he left the choices to Claude.

## 1. Effective ownership in big leagues

Why: the Live page's effective ownership list only covers leagues of 100
teams or fewer (8 of Clement's 21). His 13 bigger leagues get nothing,
though the sync already reads a sample of their picks: the top 10 and the
10 teams either side of him.

Approaches:
- Two groups with a switch, "Top 10" and "Around you" (chosen). The
  leaders show what the top of the league owns; the neighbours show what
  decides whether he climbs or drops places.
- One combined group (rejected): averaging rank 1 with rank 5,000 blurs
  both signals.

What gets built:
- The sync's `live_picks` also sends big leagues, marked `kind: "sample"`,
  with only the sampled teams plus Clement, each tagged with its groups
  (`top`, `around`, or both) and its league rank before the week.
- `/api/live` works out each group's live table and effective ownership
  separately (`lib/live.ts`, `sampleGroups`), with Clement in both.
- The Live page shows a "Top 10 / Around you" switch for these leagues and
  a line saying the table is a sample of N teams. Small leagues don't
  change.

## 2. Pull to refresh on the iPhone

Why: Safari has pull to refresh, but the site saved to the Home Screen
loses it.

- Only in the Home Screen app (`navigator.standalone` or
  `display-mode: standalone`), so Safari tabs keep their own and nothing
  doubles up.
- At the top of a page, pulling down shows a small spinner that follows the
  finger. Let go past 70 px and the page reloads; let go before and it
  springs back.
- One client component in the layout (`PullToRefresh.tsx`). The pull
  maths (how far the spinner moves, when it triggers) is a pure function
  with tests.

## Not in scope

Effective ownership before the deadline on the Leagues page.
