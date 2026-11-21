# SquadSense: handoff for Claude Code

Read this first. It covers what we're building, what's decided, what's done and what comes next. Last updated 20 November 2026, when the project moved from Claude chat to Claude Code.

## What SquadSense is

A personal Fantasy Premier League (FPL) helper for Clement (FPL team ID `11304359`), with a few family members' teams added later. It runs on free data and free hosting only.

It should:

1. Recommend the best starting eleven and captain each gameweek.
2. Suggest who to buy and sell, based on form, injuries, fixture difficulty and underlying stats (xG, xA, minutes).
3. Track price changes and send alerts before deadlines and before the nightly price change.
4. Plan transfers across a 3 to 5 gameweek window and suggest when to play chips.
5. Let Clement test squad changes and budget maths before he makes them on the official FPL site. The app never makes transfers itself.
6. Support UEFA Champions League Fantasy as an add-on, using a manual team import.

## How Clement wants to work

This project lives in `Documents/Workspace/Coding-Workspace/Output/squadsense/`. The workspace has its own rules, and they apply here:

- Read `../../_MANIFEST.md` and load the core context files it lists from `../../Context/` before starting work. `working-style.md` and `coding-context.md` matter most.
- Show a short plan and wait for his approval before doing anything. State your reading of the task in one sentence. Ask up to 3 questions if it's unclear.
- If something unexpected comes up mid-task, stop and say so. If you're less than 80% confident in a decision, say that too.
- He's learning, so explain what the code does and why, in plain English. Comment every function. Use descriptive names. Keep functions short. No dead code. Never swallow errors silently.
- Every comment, docstring, README and commit message must pass `../../Tools/humanizer-checker/checker.py`. Paste the full checker output before presenting finished work, then state the result of the manual checks for rules 10, 11, 14 and 25. Known false positives are in `../../Context/checker-notes.md`.
- No em dashes anywhere. American English. Be direct; no filler.
- Never delete files without his explicit confirmation. Don't touch anything outside this project folder unless he says so.

## Decisions so far

| Topic | Decision | Why |
| --- | --- | --- |
| Platforms | FPL first. Champions League Fantasy only, as an add-on. | FPL has a free public API. UEFA's player feed is public, but reading your own team needs a login. |
| UEFA team | Manual import: paste team data or pick players by hand | Avoids storing UEFA logins |
| Data sources | Free only. FPL's own API covers xG, xA, defensive contributions and injury news. | Clement's choice. FBref lost its advanced stats in January 2026. |
| FPL login | Not used. Bank, selling prices and free transfers are rebuilt from public data. | No sensitive tokens to store. Can be added later for his account if estimates prove off. |
| Users | Mostly Clement; family later, by team ID, with no user accounts | Keeps it simple |
| Stack | Python jobs, Supabase (Postgres), Next.js website on Vercel, GitHub Actions for scheduling | All free tiers. Clement already has GitHub, Vercel and Supabase accounts. |
| Alerts | Phone push and email | Clement's choice. Not built yet. Web push plus Resend is the current plan; Resend's free tier limits haven't been checked. |
| Main device | MacBook (desktop layout first); phone layouts as a companion | Clement's choice after the first design round |
| Backtesting | Against full past seasons (vaastav dataset) plus this season so far | His own past seasons can't be replayed: the API only keeps season totals, not weekly picks |

## What's done

### Research (`docs/research-and-planning.md`)

FPL endpoints, rate limits, login situation, UEFA feed, free data sources, 2026/27 rules, the expected points (xP) formula, fixture difficulty, risk flags and the architecture. A few details there were later changed. Tailwind wasn't used (plain CSS). Alerts are push and email (not Telegram). Section 5's questions are answered in the table above.

### Design (`docs/design/`)

17 screens on a Claude Design canvas: 9 desktop, 8 phone. `docs/design/design-notes.md` has the colors, fonts, screen list and known design issues. The live canvas is at https://claude.ai/artifact/3unEWXJuy4o28HJTtBpijv (Clement can open it; you can't).

### First build (this folder)

Python data job (`jobs/`):
- `fpl_client.py`: FPL API client. One request a second, retries with backoff on 429 and 5xx, adds trailing slashes, raises `FplApiError` on bad responses.
- `rules.py`: squad shape, budget, club limit, formation rules, scoring points, selling price formula.
- `squad_state.py`: rebuilds bank, selling prices and banked free transfers from public endpoints.
- `fixtures.py`: club attack and concede ratings built from this season's match xG, blended with FPL's 1-5 overall rating while the sample is small (FPL's attack and defence strengths are all 0 in 2026/27); expected goals per fixture; clean-sheet chance; window scores for attackers and defenders.
- `squad_builder.py`: picks the best 15 for one gameweek with an integer programming solver (PuLP 2.x calling HiGHS). Used while a team's picks are still hidden. PuLP's bundled CBC solver is Intel-only on Macs, so it isn't used.
- `model.py`: per-player xP per gameweek (recency-weighted per-90 rates, pulled towards a position baseline for small samples, scaled by fixture).
- `flags.py`: injury, yellow-card ban and rotation warnings.
- `planner.py`: best eleven and captain, legal transfer checks, best single-transfer suggestions with "make it or roll" advice.
- `chips.py`: Chip Planner. Chip windows come from bootstrap `chips` (each chip twice: GW1-19 and GW20-38). For each week left in the current half it values Bench Boost (bench xP), Triple Captain (captain xP once more) and Free Hit (best one-week squad within budget, via `squad_builder`, minus your lineup), then tries every week combination so no two chips share a gameweek. Wildcard gets no value. Free Hit and Wildcard are skipped in a team's first week, when transfers are unlimited.
- `past_seasons.py`: loads downloaded past seasons (vaastav dataset, in `jobs/.data/past/<season>/`) into live-API shapes. Maps the old `strength` column (1-5) onto `strength_overall_*` and skips 2024-25 assistant manager rows.
- `backtest.py`: `python -m squadsense.backtest` predicts each gameweek from earlier matches only and scores starters (top20, captain, slope, mae, bias per position). `--tune` runs a coordinate search. Results are in `docs/backtest-results.md`.
- `player_detail.py`: one detail entry per player (header, last 6 gameweeks with doubles added together, per-90 rates, next 6 fixtures rated like the ticker, price status). Stored in the snapshot as `playerDetails`.
- `price_watch.py`: Price Watch rows from FPL's own predictor fields (progress, next-change projection and its -5 to 5 likelihood, price locks), sorted by progress, plus the squad's at-risk and rising players (likelihood 3 or more). The likelihood bands were read from live data, not documentation.
- `ticker.py`: Fixture Ticker data for the next 8 gameweeks: each match's attack and defence difficulty (1 easiest to 5 hardest, split into five equal groups across all matches shown) and window scores for 3, 5 and 8 weeks.
- `snapshot.py`: runs the model and packs everything the website needs into one JSON snapshot.
- `storage.py`: the same methods for local JSON files or Supabase.
- `sync.py`: the job's entry point (`python -m squadsense.sync`).
- `tests/`: 27 pytest tests and a made-up FPL dataset (`sample_data.py`) used by the tests and the website's demo mode. The sample mirrors the 2026/27 API shape (zeroed strengths, `fixture` and `was_home` on history rows).

Database: `db/schema.sql` creates the tables (`api_cache`, `player_history`, `predictions`, `price_snapshots`, `snapshots`) with row level security on.

Scheduling: `.github/workflows/sync.yml` runs the job every hour, every 15 minutes in the three hours before the midnight price change, and does a full refresh each night. It does nothing until the repo is on GitHub with the `DATABASE_URL` and `FPL_TEAM_ID` secrets set.

Website (`web/`, Next.js 15, React 19, TypeScript, plain CSS):
- Top header on every page (`TopNav.tsx`): logo, page links with a sliding slanted highlight, and the deadline. A footer carries the last-sync note. The old sidebar is gone; Champions League and Alerts have no link until they're built.
- Broadcast redesign (21 November 2026), mocked up on the canvas at https://claude.ai/artifact/B6K3UD5vNh16phcUFEp6kQ (board D). Rule: every fact appears in one place only on a page, and every repeated element sits in a fixed-size slot so text length never shifts the layout. Styles are the `bc-` classes at the end of `globals.css`; fonts are Barlow Condensed (headings, numbers), Inter and Space Grotesk. Every page now uses it: each has a `PageHero` (big italic title, subtitle, and only figures unique to that page: live plan figures on the Planner, the 00:00 countdown on Price Watch, chips and gameweeks left on Chips). The pitch is one shared component, `BroadcastPitch`, used by the Dashboard (opens the player panel) and the Planner (picks a player to replace, with orange and lime states).
- Polish pass (commit f730550; the guide it followed was later deleted): card lighting, focus rings, tabular digits, pitch markings, club shirts (`ClubKit.tsx`, colors keyed by club code, 2026/27 clubs plus recently relegated ones), counting numbers (`AnimatedNumber.tsx`), and Motion (`motion` package) for the sliding toggle and sidebar pills, ticker row reordering, the player panel's enter and exit, and the Planner's move list. `MotionConfig reducedMotion="user"` in `PlayerPanel.tsx` and CSS media queries turn motion off when macOS "Reduce motion" is on. Motion adds about 50 KB to each page's first load; `LazyMotion` could trim it.
- Dashboard (`app/page.tsx`, sections in `components/dashboard/`, helpers in `lib/dashboard.ts`): projection hero with five-week bars, squad money card, pitch and substitutes with club shirts (`LineupBoard`), a "This week" card with the three decisions (transfer, captain, chip), then a Squad analysis section with a table (price, five-week xP, form sparkline from the new `form` field, next three fixtures, price change with a TONIGHT tag) and "Keep an eye on" (player warnings and chips for later weeks).
- Fixture Ticker (`/fixtures`): attackers/defenders toggle, 3/5/8 gameweek window, blanks, doubles, and "Highlight my teams", which fades clubs you don't own players from. The score column shows real units (expected goals or expected clean sheets) in place of the design's 0-50 score.
- Chip Planner (`/chips`): 38-week strip (played, recommended, this week, half-way gap) and one card per chip with best week, expected gain and a reason.
- Player detail panel: slides in from the right when you click a player on the Dashboard (pitch, bench, captain list, warnings) or a name in Price Watch. `getSnapshot()` strips `playerDetails` so pages stay small; the panel loads one player at a time through `/api/players/[id]`. "Add to plan" and "Make captain" from the design aren't built, because the Planner can't preselect a player and there's no captain override yet. The watchlist (`web/lib/watchlist.ts`) is shared with Price Watch.
- Price Watch (`/prices`): summary cards (at risk, rising, countdown to 00:00 UK, last sync), All/Rising/Falling/My squad/Watchlist filters, progress bars and FPL's projection for tonight. The watchlist is saved in the browser's local storage, so it's per device.
- Transfer Planner: gameweek strip, clickable pitch and bench, replacement table filtered by budget and club limit, live bank, free transfers, hits and plan total. `web/lib/planning.ts` mirrors the Python rules for live checks.
- Data: with Supabase settings it reads the latest snapshot there. Without them it reads `web/data/snapshot.json` (written by the sync, git-ignored), and only falls back to `web/data/sample-snapshot.json` (demo mode) if that file doesn't exist.
- Snapshot field `squadSource` is `"model"` when the squad was picked by `squad_builder.py`; `freeTransfers` is `null` for a team's first gameweek, meaning unlimited.

### Verified

All 27 Python tests pass. `next build` passes with no type errors. On 20 November 2026 the real sync ran against the live API (with a model-picked squad), and every page (Dashboard, Planner, Fixtures, Price Watch, Chips, player panel) loaded on real data with no console errors.

### Not verified

- **Real squad not read yet.** The sync runs against the live API, but Clement's picks stay hidden until the GW11 deadline, so the rebuilt bank, selling prices and free transfers haven't been compared with the FPL site yet. Every other field the code reads matched the live API, except the club attack and defence strengths (now all 0, see `fixtures.py`).
- Free Hit handling: in a Free Hit week the sync plans with the previous week's picks and bank, and leaves Free Hit transfers out of purchase prices. Tested with sample data only; FPL listing Free Hit transfers in the transfer history is about 85% sure.
- Supabase, GitHub Actions and Vercel haven't been connected. Clement does those steps from the README with his own keys.

## Known gaps and assumptions

- Free transfers after a Wildcard or Free Hit: the code assumes you keep the banked ones and still gain +1 the next week (about 70% confident). Toggle `GAIN_TRANSFER_ON_CHIP_WEEKS` in `squad_state.py`.
- Model v2 (20 November 2026): `ASSIST_FACTOR` 1.4 and forward bonus prior 0.6, both measured from data. Other `model.py` weights were backtested and kept, since nothing beat them by more than noise. Still untested: `PRIOR_GAMES` and `RATING_STEP` in `fixtures.py`, `BENCH_WEIGHT` in `squad_builder.py`, and `roll_value` in `planner.py`.
- Defenders are under-rated by about 0.3 points per start this season (the first with defensive contributions). Rerun the backtest after a few more gameweeks before acting on it.
- Players kept from the original squad get their purchase price from their first match in the team's first gameweek (`started_event`), which can be £0.1m off.
- Clement's 2026/27 team was created on 20 November 2026 and starts in GW11. Its squad isn't public until the GW11 deadline (21 November, 11:00 UTC), so `sync` fails with a 404 on `picks` before then. Free transfers and starting prices now count from `started_event`.
- Transfers made for a gameweek whose deadline hasn't passed aren't visible in public data.
- Transfer suggestions only test single transfers, not pairs or roll-then-double sequences. The Chip Planner values chips separately; the transfer suggestions don't consider them.
- FPL scoring values are hardcoded in `rules.py`. The research doc suggests reading them from `game_settings` instead.
- A private GitHub repo gets 2,000 Actions minutes a month and this schedule uses about that. Either make the repo public or drop the 15-minute runs.

## Next steps, in order

1. After the GW11 deadline (21 November, 11:00 UTC), run the sync and compare bank, squad value and free transfers with the FPL site. Then hosting: upgrade Next.js 15 to 16 (2 npm security warnings), then Supabase, GitHub Actions and Vercel on a Cloudflare subdomain (README steps 3 to 5). Before Supabase, stop the `snapshots` table growing by about 1.4 MB per run (keep the latest per team), prune `price_snapshots`, and batch the `predictions` inserts.
2. Price Watch is done, using FPL's own predictor. Still open: check after a few nights whether projection offsets 1 and 2 are the following nights (about 75% sure), and use `price_snapshots` to measure how often the predictor is right.
3. Chip Planner and Fixture Ticker are done. The backtest showed the narrow xP range is realistic (slope 0.97 over 20,079 past starts), so chip values need no special fix. Still open: suggest pairs of transfers, not just one.
4. Player detail panel is done. Still open: the design's "Add to plan" and "Make captain" buttons.
5. Alerts: phone push and email (deadline reminders, price risks on owned players, injury news, yellow-card risk).
6. Phone layouts for the built pages.
7. Champions League page with manual import.
8. Backtesting is done for the xP model (see `docs/backtest-results.md`). Clement's own past seasons can't be replayed: the API only keeps season totals for past seasons, not weekly picks. Still open: backtest the chip and transfer advice.
9. Family teams: a team switcher, by team ID.

## Things to watch out for

- Prices are stored in tenths of a million everywhere (145 means £14.5m). Only `web/lib/format.ts` turns them into "£14.5m".
- Rules exist twice, in `jobs/squadsense/rules.py` and `planner.py` and in `web/lib/planning.ts`. Change both together.
- The snapshot's shape is defined by `jobs/squadsense/snapshot.py` and typed in `web/lib/types.ts`. Change both together.
- After changing the model, regenerate the demo data with `python -m tests.make_demo_snapshot` (from `jobs/`).
- Every FPL path needs a trailing slash. Keep requests at one a second or slower.
- Never commit `.env`, `.env.local` or the Supabase service role key. `.gitignore` already covers them.

## Commands

```bash
# Python job (from jobs/)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
python -m squadsense.sync --team-id 11304359 --web-snapshot ../web/data/snapshot.json

# Website (from web/)
npm install
npm run dev          # http://localhost:3000
npm run build
```

## Where things are

| Path | What it is |
| --- | --- |
| `README.md` | Setup steps for Clement, steps 1 to 5 |
| `docs/research-and-planning.md` | The research doc |
| `docs/design/` | Design screen sources, notes and canvas layout |
| `docs/brand/` | Logo files (Formation dots mark) and how to use them |
| `docs/screenshots/` | Every page at 1440 px on real data (`dashboard.png`, `planner.png`, `fixtures.png`, `prices.png`, `chips.png`) |
| `jobs/` | Python data job and tests |
| `db/schema.sql` | Database tables |
| `.github/workflows/sync.yml` | GitHub Actions schedule |
| `web/` | Next.js website |
