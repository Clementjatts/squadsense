# Rows that end together: page layout and the Review page

Design, 25 November 2026. Approved by Clement from the mockup canvas at
https://claude.ai/artifact/3vDWqaR9N9uk4odEDMZj5k ("Yes, build it").

## Why

Six pages put two columns side by side and let each column stack its own
cards, so the shorter side ended early and left an empty area while the
other kept scrolling. Measured at 1,440 px on real data: Review 796 px,
Leagues 594, Live 557, Dashboard 481, Planner 451, Chips 413. The Review
page also listed the team instead of showing it on a pitch.

## The rule

Pages are built from horizontal rows, and the cards in a row end on one line:

1. Only cards of similar length share a row, and they stretch to the same height.
2. Anything long gets a full-width row of its own.
3. A card whose content varies keeps its row's height and scrolls or pages inside.

`.row` now stretches its columns and grows each column's last card;
`.bc-row` (with `-wide`, `-2`, `-4`) is a grid of equal-height cards.

## Page by page

- Review: the team on the shared pitch (points scored, lime above the
  forecast, orange below) beside four decision tiles; expected against
  scored beside Across FPL; the season so far at full width with a slot
  for all 38 gameweeks.
- Leagues: table full width; Where you stand with Rivals' captains; Threats
  with Your differentials.
- Live: your players beside the league tables; matches full width in two columns.
- Dashboard: squad table full width; Keep an eye on beside What changed,
  which takes its neighbour's height and scrolls inside.
- Planner: pitch beside the week's check and the five-week plan; the
  replacement table full width; scenarios full width.
- Chips: blanks and doubles, then rivals' chips, each full width.

## Fixes found along the way

- Across FPL's top scorers came from saved player histories, which miss
  players not refreshed since the week. They now come from FPL's final
  points for the week (`event/{gw}/live/`, saved once as `final_points/{gw}`).
- In a Bench Boost week the bench was listed as starters and could be named
  "best captain". Starters and bench are now split by FPL's positions.
