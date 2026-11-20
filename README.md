# SquadSense

A personal Fantasy Premier League planner. It pulls your team from the public FPL API, works out expected points (xP) for every player over the next five gameweeks, and shows the results in a website built from the SquadSense design.

Built so far: the Dashboard, Transfer Planner, Fixture Ticker, Price Watch, Chip Planner and a player detail panel, all on real FPL data. Champions League and alerts are designed but not built yet; they show as "Soon" in the sidebar.

## How it fits together

```
FPL API --> jobs/ (Python, runs on a schedule) --> Supabase database --> web/ (Next.js website)
```

The Python job does all the fetching and maths, then saves one "snapshot" per run: a JSON document holding everything the website needs. The website just reads the latest snapshot. That keeps pages fast and keeps the model in one place.

The one exception is the Transfer Planner's budget and club checks. Those have to update as you click, so they run in the browser (`web/lib/planning.ts`). If you change a rule in `jobs/squadsense/rules.py`, change it there too.

| Folder | What's in it |
| --- | --- |
| `jobs/squadsense/` | FPL client, squad rebuild, fixture model, xP model, planner, storage, the sync job |
| `jobs/tests/` | Tests, plus made-up FPL responses used by the tests and the demo |
| `db/schema.sql` | The database tables |
| `.github/workflows/sync.yml` | The schedule that runs the job (see step 4) |
| `web/` | The website |
| `docs/` | Research doc, design screens and screenshots |
| `CLAUDE.md` | Handoff notes for Claude Code: goals, decisions, progress and next steps |

## 1. Try the website with sample data

You need Node.js 20 or newer. From the `web/` folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000. Until the sync job (step 2) has run, it shows made-up sample data and says so at the top. After that it shows real FPL data from `web/data/snapshot.json`.

## 2. Run the job against the real FPL API

You need Python 3.11 or newer. From the `jobs/` folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
python -m squadsense.sync --team-id 11304359 --web-snapshot ../web/data/snapshot.json
```

The first run downloads every player's match history, about one player a second, so expect around 13 minutes. Later runs only refresh your squad and finish in under a minute. Results go into `jobs/.data/`, and the `--web-snapshot` option writes a copy the website reads. That file holds your team, so `.gitignore` keeps it out of git.

If your squad isn't public yet (FPL hides a new team's picks until its first deadline), the job picks the best squad it can for £100m instead and the website labels it as model-picked. Your real squad replaces it on the first run after the deadline.

## 3. Connect Supabase

1. Create a new Supabase project (free tier).
2. Open the SQL editor, paste in `db/schema.sql` and run it.
3. Copy `jobs/.env.example` to `jobs/.env`. Paste the connection string from Project Settings > Database into `DATABASE_URL`.
4. Run the sync again with the settings loaded: `set -a; source .env; set +a; python -m squadsense.sync`
5. Copy `web/.env.example` to `web/.env.local` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Project Settings > API.

The service role key can read the whole database. Keep it in `.env.local` and in Vercel's settings, nowhere else. `.gitignore` already keeps `.env` files out of git.

## 4. Schedule the job with GitHub Actions

1. Push this folder to a new GitHub repository. It's already a git repository with the workflow in `.github/workflows/`.
2. In the repository settings, add two secrets under Secrets and variables > Actions: `DATABASE_URL` and `FPL_TEAM_ID`.
3. Open the Actions tab, pick "Sync FPL data" and press "Run workflow" once to check it works.

After that it runs every hour, every 15 minutes from 21:00 to midnight (before the price change), and does a full refresh at 01:37 each night.

A private repository gets 2,000 free Actions minutes a month, and this schedule uses roughly that much. Either make the repository public (unlimited minutes, and there are no secrets in the code) or delete the 15-minute line in `sync.yml`.

## 5. Put the website on Vercel

Import the repository in Vercel, set the root directory to `web`, and add `FPL_TEAM_ID`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment variables. The free Hobby plan covers personal use.

## How the numbers are worked out

xP for one match adds up appearance points, goals and assists scaled by how many goals his team should score, clean sheets, saves, defensive contribution points and bonus. FPL stopped publishing club attack and defence ratings in 2026/27, so the fixture model builds its own from this season's matches: each club's xG for and against per game, compared with the league average. With few games played, it leans on FPL's 1-5 overall club rating instead. Recent matches count more than older ones, and players with few minutes are pulled towards a typical player in their position. Section 3 of the planning doc has the formula.

The model's weights were checked against three past seasons (see `docs/backtest-results.md`). The model's top pick each week averaged about 7 real points, and its top 20 about 5, against roughly 3.2 for a typical starter. A few weights in `fixtures.py`, `planner.py` and `squad_builder.py` are still untested guesses and say so in their comments.

## Backtesting the model

`jobs/squadsense/backtest.py` checks the xP model against real points from past seasons. Results and what they changed are in `docs/backtest-results.md`.

The past seasons come from the community dataset at https://github.com/vaastav/Fantasy-Premier-League (credit to Vaastav Anand; the data itself is from the official FPL API). Download three seasons, about 17 MB, from the `jobs/` folder:

```bash
for season in 2022-23 2023-24 2024-25; do mkdir -p .data/past/$season; for file in gws/merged_gw.csv fixtures.csv teams.csv; do curl -fsSL -o ".data/past/$season/$(basename $file)" "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/$season/$file"; done; done
```

Then run `python -m squadsense.backtest`. It also checks this season, using the history the sync job has already saved. Add `--tune` to search for better weights. Only keep a change if it also improves this season's numbers.

## Known gaps and assumptions

- Bank, selling prices and free transfers are rebuilt from public data. Transfers made for a gameweek whose deadline hasn't passed won't show up.
- Free transfers after a Wildcard or Free Hit: I've assumed you keep your banked ones and still get +1 the next week. I'm about 70% sure. It's one setting at the top of `squad_state.py`.
- Players in your original squad get their price from their first match in your team's first gameweek, which can be off by £0.1m if the price moved between picking the squad and that match. Until that first gameweek has been played, they're priced at today's price and marked as estimates.
- The planner doesn't model chips yet.

## Next build

Hosting first (Supabase, GitHub Actions and Vercel, steps 3 to 5), then phone push and email alerts, the Champions League import and phone layouts. Transfer suggestions will also learn to test pairs of transfers, not just one.
