# Mobile layout plan for SquadSense

This plan adapts the phone layouts in `docs/design/phone/` to the built website in `web/`, keeping the Broadcast look established on 21 November 2026 (`Barlow Condensed` italic headings and numbers, `#0b1220` panels, `#1e2b47` borders, `#121c33` raised tiles with `3px` lime top edges, and `-12deg` slanted tags and buttons). Every fact still appears in one place per page.

Desktop screens above `560px` stay as they are. All phone layout changes apply at `@media (max-width: 560px)` (plus `@media (max-width: 760px)` where wide two-column cards stack early).

Some of the phone basics are already built (commit `fc89365`): the shared 12px page edge, `18px 16px` card padding, full-width filter buttons and the phone pitch slot sizes. This plan doesn't set those again.

Line numbers below were right on 22 November 2026 and will drift after the first step lands, so use them as pointers only.

---

## 0. How this plan matches the phone designs

The phone designs in `docs/design/phone/` were drawn in the first design round, before the Broadcast redesign. Their layout is followed here; their look (Space Grotesk headings, `#16213A` cards, rounded corners) is replaced by the Broadcast look, as on desktop.

| Design screen | What the design shows | What this plan does |
| --- | --- | --- |
| `Main.dc.html` | Header with name, team ID and bell; a deadline strip with GW tag and countdown; a 3-stat strip (bank, free transfers, squad value); pitch and bench; a captain card; 5-tab bottom bar | Same order. The deadline moves into the header as a badge, and a search button is added next to the bell because ⌘K search exists. The captain stays in the "This week" card (one place per fact). |
| `Transfers.dc.html` | No pitch. A 5-GW strip, the move list (OUT and IN rows with prices and gain), a checks strip (bank after, transfers used, points hit, budget, club limit, formation), "Make it now or roll?", then suggested targets | Step 4 follows this order on phones, with no pitch (chosen 22 November 2026). A "Pick who to sell" list by position replaces tapping a shirt. Desktop keeps the pitch. |
| `Prices.dc.html` | A warning banner for your falling players, then three short lists: Your players, Likely to rise, Likely to fall. Each row shows name, club, price and progress % | Step 5 uses the same two-line rows. It keeps the built page's filters and watchlist instead of three fixed lists, and the squad's at-risk players already sit in the page's summary cards. |
| `Fixtures.dc.html` | 3-letter club codes, 5 GW columns, a score column, a color key | Same. The built ticker already uses 3-letter codes. |
| `Chips.dc.html` | Chips left and the deadline, then one stacked card per chip with its best week and a reason; no 38-week strip | Chip cards stack the same way. The 38-week strip is kept but scrolls sideways, since it shows chips the plan has already placed. |
| `Player.dc.html` | Name, club, position and price; 4 tiles (xP, owned, minutes, selling price); xG and xA bars for the last 6; 6 fixtures in one row; team news; two buttons | Step 8 follows this. The built panel has more buttons (captain, replace, compare); they stay. |
The built site has screens the phone designs never drew. They follow the same Broadcast phone rules as the rest:

| Built screen | Route or component | Step |
| --- | --- | --- |
| Your plan explained | `/plan` | Step 9 |
| Leagues | `/leagues` | Step 9 |
| Review | `/review` | Step 9 |
| Live | `/live` | Step 9 |
| Compare | `/compare` | Step 9 |
| Login | `/login` | Step 10 |
| What changed (Dashboard card) | `WhatChanged.tsx` | Step 10 |
| Apply to FPL (Planner, on the Mac copy only) | `ApplyToFpl.tsx` | Step 10 |
| Player search | `SearchPalette.tsx` | Step 2 |
| Alerts and account menu (the bell) | `AccountMenu.tsx` | Step 2 |
| More menu (new) | `TopNav.tsx` | Step 2 |

The design's bottom bar is Squad, Plan, Fixtures, Prices and More, and its More tab opens the Chips page. The built site has five pages the design doesn't have, so Step 2 turns More into a short menu instead, with Chips first.

Left out: the Captain Picker and Alerts settings designs (`Captain.dc.html`, `Alerts.dc.html`) aren't built on the website, so this plan doesn't cover them. Champions League Fantasy was dropped on 22 November 2026.

---

## 1. Visual rules for the phone version

- Keep the Broadcast palette and typography on phones: `--panel` (`#0b1220`), `--raised` (`#121c33`), `--panel-line` (`#1e2b47`), `--accent` (`#b7f34a`), `--warn` (`#ffa24c`), `Barlow Condensed` for headings and numbers, and `Inter` for body copy.
- Use the spatial layout from `docs/design/phone/`: a compact top bar, a fixed bottom navigation bar, compact 3-column and 4-column stat strips, two-line player cards on Price Watch, 3-letter club codes on the Fixture Ticker, and a single-row gameweek selector on the Transfer Planner.
- Respect iPhone Home Screen app margins: pad the top header and the bottom tab bar with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` so the iPhone notch and home indicator never cover interactive controls.
- Keep every touch target at least `44px` tall or wide, and set every `<input>` and `<select>` to `16px` font size on phones so iOS Safari never auto-zooms the page on tap.

---

## 2. Step-by-step build plan

### Step 1: Viewport, safe areas, and shared Broadcast typography on phones

Files to touch:
- `web/app/layout.tsx`
- `web/app/globals.css`

What changes:
1. Export a `viewport` object from `web/app/layout.tsx` with `width: "device-width"`, `initialScale: 1`, `viewportFit: "cover"`, and `themeColor: "#070b14"` (the page background in `globals.css`). That tells iOS Safari to extend the dark background behind the status bar and home indicator. `layout.tsx` already sets `appleWebApp.statusBarStyle` to `"black-translucent"`, so in the Home Screen app the page runs under the status bar and the safe-area padding below is what keeps controls clear of it.
2. In `web/app/globals.css` inside `@media (max-width: 560px)`, reserve space below the footer (`.site-footer { padding-bottom: calc(72px + env(safe-area-inset-bottom)) }`) so the fixed bottom navigation bar never covers the footer or the last card on a page. It goes on the footer, not `body`, because the login page has no bottom bar (see Step 10).
3. Scale down oversized Broadcast display type at `@media (max-width: 560px)`:
   - `.bc-page-title`: `42px` (`line-height: 0.94`, down from `72px`).
   - `.bc-section-title`: `30px` (`line-height: 32px`, down from `44px`), with `.bc-section-slash` height set to `32px`.
   - `.bc-giant`: `76px` (down from `132px`).
   - `.bc-decision-name`: `34px` (`line-height: 34px`, down from `56px`), with `.bc-decision-name-small` set to `26px` (`line-height: 28px`).
   - `.bc-decision-number`: `40px` (`line-height: 38px`, down from `64px`), with `.bc-decision-number-small` set to `32px` (`line-height: 32px`).
4. Make `PageHero` stat boxes fit side by side on phones (`web/components/PageHero.tsx`, `web/app/globals.css` lines 407-413):
   - Set `.bc-page-hero` padding on phones to `18px 16px` and `gap: 14px`.
   - Set `.bc-page-hero-side` to `width: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px`.
   - Set `.bc-hero-figure` to `width: auto; height: 76px; padding: 10px 12px` and `.bc-hero-figure-value` to `font-size: 26px; line-height: 28px`. That lets two or three hero figures sit in one clean row on a 360px-390px phone instead of stacking one per line at 176px width.
5. Fix `.summary-grid` overflow on phones (`web/app/globals.css` lines 83, 440-441, 558):
   - Change `.summary-grid > div` to `min-height: 74px; height: auto; padding: 10px 12px; gap: 4px` instead of a fixed `84px` height.
   - Drop `.summary-grid b` to `22px` (`line-height: 24px`).
   - Switch 4-item summary grids (`.summary-grid.rival-holding` in `web/components/RivalChipsCard.tsx` and the 4-stat grid in `web/app/review/page.tsx`) to `grid-template-columns: repeat(2, minmax(0, 1fr))` below `560px`.

---

### Step 2: Compact top bar and 5-tab bottom navigation bar

Files to touch:
- `web/components/TopNav.tsx`
- `web/components/SearchPalette.tsx`
- `web/components/AccountMenu.tsx`
- `web/app/globals.css`

What changes:
1. Slim top bar on phones (`web/components/TopNav.tsx`, `web/app/globals.css`):
   - Matching `docs/design/phone/Main.dc.html`, hide `.topnav-links` in the top header below `560px`.
   - Keep `.topnav` as a single compact row (`padding: calc(10px + env(safe-area-inset-top)) 12px 10px`) holding the brand on the left and the search button, alerts bell, and a compact deadline badge (`GW11 · Sat 11:00`) on the right.
   - Set `.topnav-wordmark` to `22px` on phones (down from `28px`). Hide `<kbd>⌘K</kbd>` inside `.topnav-search` so the search button becomes a `42px x 42px` icon button next to the `42px x 42px` bell button.
2. Fixed 5-tab bottom bar on phones (`web/components/TopNav.tsx`, `web/app/globals.css`):
   - Add a `<nav className="bottomnav" aria-label="Mobile">` rendered inside `TopNav.tsx`, hidden on desktop (`display: none`) and fixed to the bottom on phones (`@media (max-width: 560px)`).
   - Include the five primary tabs from `docs/design/phone/Main.dc.html`:
     - `Squad` (`/`)
     - `Plan` (`/planner`, also active on `/plan`)
     - `Fixtures` (`/fixtures`)
     - `Prices` (`/prices`)
     - `More` (opens a short menu above the bar listing `Chips`, `Leagues`, `Review`, `Live`, and `Compare`, with Chips first as in the design, and highlights in lime whenever you are on one of those five routes). The menu closes on Escape, on a tap outside it, and when a link is chosen, and moves keyboard focus into itself when it opens.
   - Style the active tab in the Broadcast look: lime icon and `Barlow Condensed` uppercase label (`#b7f34a`) with a `3px` slanted lime top indicator bar.
   - Add `padding-bottom: calc(8px + env(safe-area-inset-bottom))` to `.bottomnav`.
   - Stacking order: the bottom bar sits above page content but below every overlay. The player panel and its backdrop, the search palette, the account panel and the More menu all need a higher `z-index` than `.bottomnav`, so none of them is cut off by the bar.
3. Keep the alerts and account panel on screen (`web/components/AccountMenu.tsx`, `web/app/globals.css` line 661):
   - Below `560px`, set `.account-panel` to `position: fixed; top: calc(64px + env(safe-area-inset-top)); left: 12px; right: 12px; width: auto; max-width: none` instead of `position: absolute; right: 0; width: 290px`. That stops the dropdown from clipping off the left edge of the screen.
4. Keep player search above the mobile keyboard (`web/components/SearchPalette.tsx`, `web/app/globals.css` lines 512-516):
   - Below `560px`, set `.search-backdrop` `padding-top` to `calc(12px + env(safe-area-inset-top))` and cap `.search-results` at `max-height: 45dvh` so the keyboard never hides the results list.
   - Narrow `.search-result` columns on phones to `minmax(0, 1fr) 84px 54px` (`padding: 0 14px`).

---

### Step 3: Dashboard / My Squad layout on phones

Files to touch:
- `web/components/dashboard/ProjectionCard.tsx`
- `web/components/dashboard/SquadCard.tsx`
- `web/components/dashboard/ThisWeekCard.tsx`
- `web/components/dashboard/KeepAnEye.tsx`
- `web/components/dashboard/SquadTable.tsx`
- `web/app/globals.css`

What changes:
1. Compact top summary cards so the pitch sits near the top (`docs/design/phone/Main.dc.html` lines 26-43, `web/app/globals.css` lines 298-318):
   - Remove `min-height: 300px` on `.bc-hero` and `.bc-squad` below `560px` (`min-height: 0; gap: 12px`). Their padding is already `18px 16px` on phones.
   - In `ProjectionCard.tsx`, keep the 76px projected score and the 5-week bars on one row by setting `.bc-hero-body` to `flex-wrap: nowrap; justify-content: space-between; gap: 12px` and `.bc-bar-col` to `width: 34px; height: 96px`.
   - In `SquadCard.tsx`, style `.bc-stat` to match the compact 3-column strip in `Main.dc.html` (`height: 72px; padding: 10px 12px`) with `.bc-stat-value` at `24px` (`line-height: 26px`) so `£102.3m` fits inside a 360px phone without clipping.
   - Make `.bc-squad-foot .bc-button` full-width (`width: 100%; justify-content: center`) on phones.
2. Pitch and substitutes (`web/components/BroadcastPitch.tsx`, `web/app/globals.css` lines 699-715):
   - Keep the existing `560px` token sizing (`flex: 0 1 66px; height: 80px`), which already fits five players across 360px.
   - Tighten `.bc-subs-row` on phones to a 4-column grid (`display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; justify-items: center`) so all four substitutes always stay in one row like `Main.dc.html` line 93 instead of wrapping to a second bench row on 360px screens.
3. "This week" decisions (`web/components/dashboard/ThisWeekCard.tsx`, `web/app/globals.css` lines 349-365):
   - Set `.bc-thisweek` horizontal padding to `16px` (down from `26px`). Set `.bc-decision` vertical padding to `16px` (down from `24px`).
   - Allow `.bc-note.bc-one-line` inside `.bc-decision-text` to wrap to two lines on phones (`white-space: normal`) so transfer explanations and captain haul odds are never cut off.
   - Set `.bc-alt` columns on phones to `76px 84px minmax(0, 1fr) 34px` (`gap: 8px; font-size: 13px`).
4. "Keep an eye on" warnings (`web/components/dashboard/KeepAnEye.tsx`, `web/app/globals.css` lines 392-397):
   - Below `560px`, change `.bc-eye-row` to `min-height: 64px; height: auto; padding: 12px 16px; grid-template-columns: 64px minmax(0, 1fr); gap: 12px`.
   - Let `.bc-eye-text b` and `.bc-eye-text span` wrap (`white-space: normal`) so injury and suspension notes read in full, matching `docs/design/phone/Alerts.dc.html` lines 29-40.
5. Squad analysis table (`web/components/dashboard/SquadTable.tsx`, `web/app/globals.css` lines 373-386):
   - Make the `PLAYER` column sticky on horizontal scroll (`position: sticky; left: 0; z-index: 2; background: var(--panel)`) and keep bench rows matching their `#090f1c` background so you can scroll across `PRICE`, `xP`, `FORM`, `NEXT 3`, and `PRICE CHANGE` without losing the player's name.

---

### Step 4: Transfer Planner on phones

Files to touch:
- `web/components/Planner.tsx`
- `web/app/globals.css`

What changes:
1. Single-row gameweek strip (`docs/design/phone/Transfers.dc.html` line 26, `web/components/Planner.tsx` lines 156-178, `web/app/globals.css` lines 72-73, 433-439):
   - Below `560px`, change `.weeks` to a 5-column grid (`display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px`).
   - Compact `.week-card` on phones to `min-height: 0; padding: 8px 6px; border-radius: 10px; align-items: center; text-align: center` showing `GW{week}`, the `xP` number (`22px`), and a small dot or tag when a move or chip is active that week. All five gameweeks sit in one row instead of taking 380px of height.
2. No pitch on phones, as in the design (Clement chose this on 22 November 2026; mockup `PlannerB` on the phone canvas):
   - Below `560px`, hide `.col-wide` (the column that holds only the Planner's `BroadcastPitch`). Desktop keeps the pitch.
   - The page reads top to bottom: gameweek strip, the `GW check` card, the "Make it now or roll?" card, `Single moves to try`, then a new `Pick who to sell` card.
   - Inside the `GW check` card, show the `.moves` list first and the checks after it (CSS `order` on the card's children), matching the design's OUT and IN rows above the checks strip. Captain, chip picker and Apply to FPL stay below the checks. Add an `Add another transfer` button under the moves that scrolls to `Pick who to sell`.
3. `Pick who to sell` card (new, phones only; `web/components/Planner.tsx` and a new `web/components/SellList.tsx`):
   - A `GK / DEF / MID / FWD` segmented control and, for that position, each player in the selected week's squad: name, club, price and five-week xP, with a `Sell` button. The captain carries a `C` tag; a player already being sold shows an `OUT` tag and no button.
   - `Sell` calls the same `pickPlayerToReplace` the pitch uses on desktop, so the replacement list, budget checks and club limits work unchanged.
   - Rendered on every screen size but hidden above `560px` with CSS, so desktop is unchanged.
   - After `Sell`, when `window.matchMedia("(max-width: 560px)").matches` (the same breakpoint as the CSS), scroll the `Replace {player}` card into view (`scrollIntoView({ behavior: "smooth", block: "start" })`).
4. "Make it now or roll?" card (phones and desktop):
   - The website can't work out a roll value for any move you enter; only the sync's single-move suggestions carry one (`roll_value` and `advice` in `snapshot.suggestions`). So the card shows only when the week's single move matches one of those suggestions: the move's gain, the value of rolling, and "Make it" or "Roll it". For any other move it stays hidden. About 80% sure this is enough; working out roll values in `planning.ts` would mean porting `planner.roll_value` from Python, which is a separate change.
5. Mobile replacement list matching `Transfers.dc.html` (`docs/design/phone/Transfers.dc.html` line 52, `web/components/Planner.tsx` lines 320-358 and 551-589):
   - Tighten `.planner-table` on phones by hiding the `Owned` column below `560px` so `Player`, `Price`, `xP`, `Gain`, and the `Add`/`Sell` button fit across a phone card without horizontal scrolling.
6. Fix `SolverPlanCard` wrapping (`web/components/Planner.tsx` lines 488-516, `web/app/globals.css` lines 158-162):
   - Below `560px`, change `.solver-week` to a two-line grid (`height: auto; padding: 10px 0; grid-template-columns: 52px minmax(0, 1fr) auto`) where `.solver-moves` wraps onto line 2 (`grid-column: 1 / -1; white-space: normal`) so every planned transfer and chip tag is readable.
   - Add `flex-wrap: wrap` to the `Load into planner` button row (`web/components/Planner.tsx` line 509) via a `.solver-actions` class in `web/app/globals.css`.

---

### Step 5: Price Watch two-line cards on phones

Files to touch:
- `web/components/PriceWatchView.tsx`
- `web/app/globals.css`

What changes:
1. Follow `docs/design/phone/Prices.dc.html` (lines 31-77) by rendering a mobile card list alongside the desktop table in `web/components/PriceWatchView.tsx`:
   - Keep `table.prices` on desktop (`> 560px`).
   - Below `560px`, render each row in `shown` as a compact Broadcast price card (`.price-mobile-card` in `web/app/globals.css`):
     - Top row: a `40px x 40px` watchlist star button, `<PlayerLink>`, `"Yours"` slanted lime tag if owned, and `team · position · £price` on the left; direction arrow (`↑` or `↓`), progress percentage (`96%`) in `Barlow Condensed` `22px`, and a slanted `TONIGHT` tag on the right. The `TONIGHT` rule (`Math.abs(likelihood) >= 5`) already lives in `SquadTable.tsx`; move it into one shared helper in `web/lib/` and use it in both places, so the Dashboard and Price Watch can't disagree.
     - Middle row: full-width `6px` progress track with lime or orange fill (and the pulsing glow when `>= 95%`).
     - Bottom row: the same Prediction text as the desktop table (`row.prediction`, plus `row.projected` as `78% by 00:00` when it isn't null and the price isn't locked) and net transfers for the gameweek. Reuse the desktop cell's code so the two can't drift apart.
2. Keep the `All / Rising / Falling / My squad / Watchlist` segmented filter and the 25-row `Pager` above and below the list, so all filtering and pagination work identically on desktop and mobile with zero horizontal scrolling.

---

### Step 6: Fixture Ticker compact club codes and 5-GW fit on phones

Files to touch:
- `web/components/FixtureTickerTable.tsx`
- `web/app/globals.css`

What changes:
1. Match `docs/design/phone/Fixtures.dc.html` (lines 26-35):
   - The ticker already shows 3-letter codes: `jobs/squadsense/ticker.py` sends FPL's `short_name` as each club's name, so no change is needed there. Below `560px`, make the club column sticky on the left so it stays visible when the 8-GW window scrolls sideways.
   - Below `560px`, set `table.ticker td` to `min-width: 44px` (down from `64px`). Set `.fixture-stack` and `.fixture.blank` height to `34px` (down from `40px`), with `.fixture` font size at `12px`.
   - With a 3-letter club column (`42px`), five gameweek columns (`5 x 46px = 230px`), and the score column (`44px`), a 5-gameweek fixture table takes `316px` and fits inside a 360px-390px phone card with no horizontal scrolling at all.
2. Tidy `.ticker-toolbar` on phones (`web/app/globals.css` lines 94-95):
   - Stack the mode toggle (`For attackers` / `For defenders`) full-width on row 1, and place the `3 GWs / 5 GWs / 8 GWs` window toggle and `Highlight my teams` button on row 2.

---

### Step 7: Chip Planner on phones

Files to touch:
- `web/app/chips/page.tsx`
- `web/components/RivalChipsCard.tsx`
- `web/app/globals.css`

What changes:
1. Season timeline (`docs/design/phone/Chips.dc.html`, `web/app/chips/page.tsx` lines 65-109, `web/app/globals.css` lines 187-196):
   - In `Chips.dc.html`, the 38-week strip is omitted so the four chip cards appear right below the hero banner. Because the built `SeasonTimeline` carries useful "Played / Played by the plan / Saved for later" status across the whole season, wrap `.chip-timeline` in `.table-wrap` (`overflow-x: auto`) on phones and give `.chip-week` a `min-width: 28px` below `560px`. That prevents the 38 boxes from crushing into 5.2px slivers while keeping the timeline available by swiping sideways.
2. Chip cards (`web/app/chips/page.tsx` lines 142-192, `web/app/globals.css` lines 200-206, 544-549):
   - Set `.chip-card` to `flex: 1 1 100%` below `560px` so the four chip cards stack in one vertical column like `Chips.dc.html` lines 30-51.
   - Give `.chip-bars` horizontal scroll support if more than 14 weeks remain in the half (`min-width: 16px` per `.chip-bar-slot`).
3. Rivals' chips (`web/components/RivalChipsCard.tsx`, `web/app/globals.css` lines 552-558):
   - Switch `.summary-grid.rival-holding` to a 2x2 grid below `560px` so `BB still held`, `TC still held`, `FH still held`, and `WC still held` do not overflow.

---

### Step 8: Player detail panel on phones

Files to touch:
- `web/components/PlayerPanel.tsx`
- `web/app/globals.css`

What changes:
1. Follow `docs/design/phone/Player.dc.html` (lines 18-71) inside `@media (max-width: 560px)` in `web/app/globals.css`:
   - Set `.player-panel` padding to `calc(16px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))` (down from `24px`). Set `.panel-head h2` to `30px` (`line-height: 32px`, down from `40px`).
   - Keep `.panel-tiles` in a 4-column row like `Player.dc.html` line 26 by reducing `.panel-tile` padding to `10px` and `.panel-tile b` to `20px` (or `repeat(2, minmax(0, 1fr))` on screens narrower than `360px`).
   - Keep `.panel-fixtures` in a single 6-column row like `Player.dc.html` line 61 by removing the `-10deg` skew on `.panel-fixture .fixture` below `560px` and dropping its font size to `12px`.
   - Stop the page behind the panel scrolling while it is open. On iOS, `overflow: hidden` on `body` alone doesn't do this, so also set `overscroll-behavior: contain` on `.player-panel`. Set the body lock in a `useEffect` in `PlayerPanel.tsx` and remove it in that effect's cleanup, so closing the panel (Escape, the backdrop or the close button) always gives the page its scroll back.

---

### Step 9: Newer pages (`Leagues`, `Review`, `Live`, `Compare`, `Your plan explained`) and iOS form controls

Files to touch:
- `web/components/LeaguesView.tsx`
- `web/components/CompareView.tsx`
- `web/app/globals.css`

What changes:
1. Mini-leagues (`web/components/LeaguesView.tsx`, `web/app/globals.css` lines 489-497):
   - Fix `.share-row` name truncation in Threats, Your differentials, and Rivals' captains by hiding `.share-track` below `560px` and changing `.share-row` to `grid-template-columns: minmax(0, 1fr) 40px 44px 58px; gap: 8px`. That increases the player name column on a 375px phone to `153px` (up from `35px`).
   - Make the `TEAM` column in `LeagueTable` sticky on horizontal scroll, and stack `.bc-manager` (`row.manager`) on a second line under `row.teamName` on phones so team names have room.
2. Compare players (`web/components/CompareView.tsx`, `web/app/globals.css` lines 523-532):
   - Below `560px`, set `.compare-table` `min-width` to `100%` (down from `900px`) and narrow the `STAT` column to `118px` (down from `280px`). Allow stat labels (`td.muted`) to wrap across two lines (`white-space: normal; height: auto; padding: 10px 8px`). That lets you compare 2 or 3 players side by side on a phone screen with no horizontal scrolling.
   - Anchor `.compare-results` dropdown (`width: 220px; right: 0`) so it stays inside the card on narrow screens, and enlarge `.compare-remove` to `32px` (up from `24px`).
3. Live gameweek and Gameweek review (`web/components/LiveView.tsx`, `web/app/review/page.tsx`):
   - Make the `PLAYER` / `STARTER` first column sticky on `.bc-table` below `560px` and reduce table `min-width` (`560px` and `520px`) to `440px`.
4. Your plan explained (`web/app/plan/page.tsx`, `web/app/globals.css` lines 613-650):
   - The existing `@media (max-width: 760px)` rule already stacks `.plan-move` and `.plan-squad-change` into a single column. Add mobile table styling for `ChipReasons` so the `CHIP` column is sticky and `.plan-actions .btn` spans full width on phones.
5. Prevent iOS Safari input auto-zoom (`web/app/globals.css` lines 529, 533):
   - Set `font-size: 16px` on `.bc-select` and `.compare-input` inside `@media (max-width: 560px)`.

### Step 10: Login, What changed and Apply to FPL on phones

Files to touch:
- `web/app/login/page.tsx` (only if a class name is needed)
- `web/components/dashboard/WhatChanged.tsx`
- `web/components/ApplyToFpl.tsx`
- `web/app/globals.css`

What changes:
1. Login (`/login`):
   - The login page is drawn by its own branch of `layout.tsx` with no header, so it gets no bottom bar. Step 1 puts the bottom-bar padding on `.site-footer`, which the login page doesn't have, so it gains no empty space at the bottom.
   - The sign-in card already has a `480px` rule and `16px` inputs. Add `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` to `.signin-stage` padding so the card stays clear of the notch in the Home Screen app, and shrink `.signin-glow` to `320px` below `560px` so its blur doesn't cost scrolling speed on older iPhones.
2. What changed (Dashboard):
   - Below `560px`, set `.changes-entry` padding to `12px 16px` to match the other phone cards, and let long sentences wrap (`overflow-wrap: anywhere`) so player names with no spaces never push the card wider than the screen.
3. Apply to FPL (Planner, Mac copy only):
   - This box only shows on `localhost`, so a phone only sees it when testing the Mac copy over the home network. Below `560px`, make its buttons full width, stack the `.apply-preview` lines in one column, and give the `APPLY` confirmation input `16px` text so iOS doesn't zoom in.

---

## 3. Build order

Build Steps 1 and 2 first and check them on the iPhone from the Home Screen icon before any page work. The bottom bar and header decide how much height every page has, so the per-page steps depend on them. After that, one step per commit, in the order above.

---

## 4. Verification checklist (when implemented)

1. Run `npm test` and `npm run build` in `web/` to confirm zero TypeScript or payload errors.
2. Check every route (`/`, `/planner`, `/plan`, `/fixtures`, `/prices`, `/chips`, `/leagues`, `/review`, `/live`, `/compare`, `/login`) at `360px x 800px` and `390px x 844px` (iPhone) and at `1440px x 900px` (MacBook) to verify:
   - Desktop layout is unchanged at `1440px`.
   - No page has unintended horizontal document overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
   - The 5-tab bottom bar navigates cleanly and opens the `More` sheet for secondary pages.
   - On phones the Planner shows no pitch, and `Sell` in `Pick who to sell` scrolls to the replacement list. Desktop still shows the pitch.
   - Price Watch cards, Fixture Ticker 5-GW view, Compare table, and Player Panel all fit cleanly inside a phone viewport.
3. Run `python3 ../../Tools/humanizer-checker/checker.py` on all modified comments and docs.
