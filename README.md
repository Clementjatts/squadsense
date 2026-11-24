# SquadSense

A personal Fantasy Premier League planner. It pulls your team from the public FPL API, works out expected points (xP) for every player over the next five gameweeks, and shows the results in a website built from the SquadSense design.

Built so far, all on real FPL data:

- Dashboard, Transfer Planner (with a five-week plan of transfers and chips from a solver, explained in full on "Your plan explained"), Fixture Ticker, Price Watch and Chip Planner (risk, known blanks and doubles, and your rivals' chips).
- How sure each move is: the plan is worked out again 15 times with every player's expected points nudged at random, and each move shows how often it came back. Moves affected by tonight's likely price changes say so ("buy now: likely to rise £0.1m tonight").
- What changed: after each sync the Dashboard lists what moved since earlier syncs, such as a player's expected points, injury news, prices, the plan's moves and chip decisions.
- One chip strategy for every page: chips are planned together with your transfers, measured against the free transfers you'd make anyway, and played only when they beat saving them for later in the half. A Wildcard also needs a 5-point margin, and anything within 2 points is shown as a close call.
- Leagues: your mini-league tables, what rivals own and captain, threats and differentials.
- Review: last gameweek's points next to the model's expected points, and your captain against the best one you had.
- Live: points during a gameweek, with provisional bonus, automatic subs and live league tables, refreshed every minute.
- Compare: up to three players side by side. Press ⌘K on any page to search for a player.

Alerts reach your phone and email; the separate Alerts settings page from the design isn't built.

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

Copy `web/.env.example` to `web/.env.local` and set `SITE_PASSWORD` (what you'll sign in with) and `SITE_SECRET` (a long random string; the file says how to make one). Every page needs that password.

Open http://localhost:3000 and sign in. Until the sync job (step 2) has run, it shows made-up sample data and says so at the top. After that it shows real FPL data from `web/data/snapshot.json`.

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

Import the repository in Vercel, set the root directory to `web`, and add `FPL_TEAM_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_PASSWORD` and `SITE_SECRET` as environment variables. Don't add `FPL_EMAIL` or `FPL_PASSWORD` there. The free Hobby plan covers personal use.

## 6. Turn on alerts

Alerts arrive by email and as phone or browser notifications. Each gameweek has two plan emails: a plan brief about a day before the deadline and a final call about 2.5 hours before, listing what changed since the brief. Each transfer, captain and chip is marked FIRM, CLOSE CALL (either choice is fine) or MAKE NOW (a price change tonight makes it worth doing early). Act on the final call; the brief is a heads-up. Between the two you only hear about real news: injuries on your players, a player one yellow card from a ban, and a player the plan sells who is likely to drop in price tonight. Each alert is sent once.

1. **Push keys.** From `jobs/`, run `python -m squadsense.make_push_keys`. Add the public key to Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (then redeploy, since Next.js builds it into the page) and the private key to GitHub as the secret `VAPID_PRIVATE_KEY`. Add `VAPID_SUBJECT` too: `mailto:` followed by your email address.
2. **Email.** Make a free account at resend.com (100 emails a day, 3,000 a month), create an API key and add it to GitHub as `RESEND_API_KEY`. Add `ALERT_EMAIL_TO` with the address alerts should go to. Until you verify a domain in Resend, emails come from Resend's test address and can only go to the address you signed up with. To send from your own address: in Resend open Domains, add `clementadegbenro.com`, and copy each DNS record it lists into Cloudflare (DNS, then Add record). They only add sending records, so your existing email keeps working. Once Resend shows the domain as verified, add the GitHub secret `ALERT_EMAIL_FROM` as `SquadSense <squadsense@clementadegbenro.com>` and run the test alert. Replies to an alert go to your `ALERT_EMAIL_TO` address.
3. **Links.** Add `SITE_URL` to GitHub with the site's address, so tapping a notification opens the right page.
4. **Your phone.** Open the site, tap the bell in the header and choose "Turn on alerts". On an iPhone, first add the site to your Home Screen (Share, then Add to Home Screen) and open it from there; iPhones only allow notifications for sites added that way.
5. **Test.** On GitHub, open Actions, then Sync FPL data, then Run workflow, tick "Only send a test email and phone alert" and run it. You should get one email and one notification on each device with alerts on. If one doesn't arrive, the run's log says why.

## Applying a plan to your FPL team

On the copy of the site running on your Mac, the Planner can send the coming gameweek's plan to your real FPL team: transfers, starting eleven, bench order, captain, vice-captain and chips. Add `FPL_EMAIL` and `FPL_PASSWORD` to `web/.env.local` to turn it on. Then plan the week and click "Apply GWxx to FPL".

It first signs in and shows exactly what will change, using FPL's own selling prices and free transfers, and lists anything that blocks it. It only sends the changes after you type APPLY. Transfers can't be undone.

Signing in copies the steps of AIrsenal (github.com/alan-turing-institute/AIrsenal). It doesn't pretend to be a browser, so FPL may refuse it. If that happens, the error says which step failed. Playing Bench Boost or Triple Captain this way may not work either; if it doesn't, play the chip on the FPL site. Automated access may also be against FPL's terms, so use it knowing that.

## How the numbers are worked out

xP for one match adds up appearance points, goals and assists scaled by how many goals his team should score, clean sheets, goals-conceded deductions (1 per 2 goals, rounded down), saves, defensive contribution points and bonus. When bookmakers have priced the match (free odds from football-data.co.uk), each team's expected goals are half ours and half the bookmakers'. FPL stopped publishing club attack and defence ratings in 2026/27, so the fixture model builds its own from this season's matches: each club's xG for and against per game, compared with the league average. With few games played, it leans on FPL's 1-5 overall club rating instead. Recent matches count more than older ones, and players with few minutes are pulled towards a starting point: a typical player in their position, moved towards the player's own numbers from last season. Section 3 of the planning doc has the formula.

The model's weights were checked against three past seasons (see `docs/backtest-results.md`). The model's top pick each week averaged about 7 real points, and its top 20 about 5, against roughly 3.2 for a typical starter. A few weights in `fixtures.py`, `planner.py` and `squad_builder.py` are still untested guesses and say so in their comments.

## Backtesting the model

`jobs/squadsense/backtest.py` checks the xP model against real points from past seasons. Results and what they changed are in `docs/backtest-results.md`.

The past seasons come from the community dataset at https://github.com/vaastav/Fantasy-Premier-League (credit to Vaastav Anand; the data itself is from the official FPL API). Download three seasons, about 17 MB, from the `jobs/` folder:

```bash
for season in 2022-23 2023-24 2024-25; do mkdir -p .data/past/$season; for file in gws/merged_gw.csv fixtures.csv teams.csv; do curl -fsSL -o ".data/past/$season/$(basename $file)" "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/$season/$file"; done; done
```

Then run `python -m squadsense.backtest`. It also checks this season, using the history the sync job has already saved. Add `--tune` to search for better weights. Only keep a change if it also improves this season's numbers.

To test the odds and Elo options (`--odds`, `--elo`), download football-data.co.uk's season files too:

```bash
mkdir -p .data/odds; for s in 1920 2021 2122 2223 2324 2425 2526 2627; do curl -fsSL -o ".data/odds/E0_$s.csv" "https://www.football-data.co.uk/mmz4281/$s/E0.csv"; done
```

`python -m squadsense.challenger` backtests a second, machine-learning points model (needs `pip install -r requirements-dev.txt`). `python -m squadsense.chip_backtest` tests chip timing.

## Known gaps and assumptions

- Bank, selling prices and free transfers are rebuilt from public data. Transfers made for a gameweek whose deadline hasn't passed won't show up.
- Free transfers after a Wildcard or Free Hit: I've assumed you keep your banked ones and still get +1 the next week. I'm about 70% sure. It's one setting at the top of `squad_state.py`.
- Players in your original squad get their price from their first match in your team's first gameweek, which can be off by £0.1m if the price moved between picking the squad and that match. Until that first gameweek has been played, they're priced at today's price and marked as estimates.
- The five-week plan and its chip rules (the 90% keep share, the 5-point Wildcard margin) haven't been backtested yet; only the xP model and simple chip timing have.
- Working out the plan with every chip takes one to two minutes, so it's saved and reused until your squad, bank, free transfers, chips, injury news or the gameweek change, or it's 12 hours old.
- Chip timing was backtested on six past half-seasons with a stand-in squad (see `docs/backtest-results.md`). The "play now" rule beat a random week but not "play Bench Boost in the first double gameweek".
- Captain "chance of 10+" comes from a simulation with a rough bonus guess. It hasn't been backtested.
- The live page's automatic subs follow FPL's main rules (keeper for keeper, formation stays legal, bench order). Rare cases may differ until FPL settles the week.
- Mini-league totals before the current week are worked out as the league total minus this week's points. That matches FPL's standings once a week is over.

## Mini-leagues

The sync picks your four smallest private leagues with 50 teams or fewer. To choose your own, set `SQUADSENSE_LEAGUES` to their ids, for example `SQUADSENSE_LEAGUES=1242405,1586906`. Each rival's picks are fetched once per gameweek and then cached, so a new gameweek costs about one second per rival.

Rival team and manager names come from FPL's public standings. They're saved in the snapshot, so anyone who can open your website can see them. Keep that in mind before putting the site on a public address.

## Next build

Hosting first (Supabase, GitHub Actions and Vercel, steps 3 to 5), then phone push and email alerts and phone layouts.
