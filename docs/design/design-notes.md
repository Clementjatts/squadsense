# SquadSense design notes

The full design lives on a Claude Design canvas: https://claude.ai/artifact/3unEWXJuy4o28HJTtBpijv (Clement can open it; Claude Code can't). This folder holds the source of every screen on that canvas as it stood on 20 November 2026, so the layouts, colors and copy can be read without it.

The `.dc.html` files are written in the canvas's own format. They load a `support.js` runtime that only exists on the canvas, so they won't render if you open them in a browser. Read them as markup: every screen is plain HTML with inline styles, and the copy is literal text. `{{accent}}` is the one variable; it means the lime accent below.

## Look

| Token | Value | Used for |
| --- | --- | --- |
| Background | `#0B1220` | Page |
| Surface | `#111A2E` | Sidebar, panels |
| Card | `#16213A` | Cards, rows |
| Line | `#26324D` | Borders, dividers |
| Text | `#E8EDF7` | Main text |
| Muted text | `#9AA6BF` | Labels, secondary text |
| Accent (lime) | `#B7F34A` | Primary buttons, captain badge, rises, "good" chips |
| Warning (orange) | `#FFA24C` | Injury flags, price falls, players going out |
| Blue | `#6CB4FF` | xA bars |
| Pitch stripes | `#13301F` and `#153622` | The pitch background |

Fonts are Inter for text and Space Grotesk for headings and big numbers. Rises and falls are told apart by arrow direction and lightness as well as color, so they work for color-blind users. Touch targets are at least 44px.

These tokens are already in `web/app/globals.css`.

## Screens

Desktop (MacBook) is the main workspace; the phone screens are for quick checks. Every desktop screen shares a left sidebar and a top bar showing the gameweek deadline countdown, bank, free transfers and squad value.

| Screen | Desktop file | Phone file | Built? |
| --- | --- | --- | --- |
| Dashboard / My Squad | `desktop/Desktop-Dashboard.dc.html` | `phone/Main.dc.html` | Desktop yes |
| Transfer Planner | `desktop/Planner-Desktop.dc.html` | `phone/Transfers.dc.html` | Desktop yes |
| Captain Picker | Part of the Dashboard | `phone/Captain.dc.html` | Top 3 on the Dashboard |
| Player detail | `desktop/Desktop-Player.dc.html` (a panel sliding in over the Dashboard) | `phone/Player.dc.html` | Desktop yes |
| Fixture Ticker | `desktop/Desktop-Fixtures.dc.html` | `phone/Fixtures.dc.html` | Desktop yes |
| Price Watch | `desktop/Desktop-Prices.dc.html` | `phone/Prices.dc.html` | Desktop yes |
| Chip Planner | `desktop/Desktop-Chips.dc.html` | `phone/Chips.dc.html` | Desktop yes |
| Alerts and settings | `desktop/Desktop-Alerts.dc.html` | `phone/Alerts.dc.html` | No |

`canvas.json` records where each screen sits on the canvas and its title.

## Things in the design that need fixing when built

- The Chip Planner and the planner's GW16 card both recommend Bench Boost and Triple Captain in the same week. FPL allows one chip per gameweek, so the built version must pick one and move the other.
- All numbers on the screens are invented sample data. Player names are real, but their clubs and prices may not match 2026/27.
- The Alerts screen includes a weekly summary email (your score against the model's best lineup). Clement hasn't asked for it, so treat it as optional.

## Screenshots of the built app

`../screenshots/` has the Dashboard and Transfer Planner as built, running on sample data at 1440px wide. The planner shot was taken just before two small fixes: the GW badge in the top bar is now readable, and unaffordable players in the replacement table can't be added.
