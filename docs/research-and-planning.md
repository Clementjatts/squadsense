# SquadSense: Research and Planning

Written 19 November 2026, before any code. Exported from the Claude doc of the same name. A few plans changed after this was written; `CLAUDE.md` in the project root lists what changed and wins where the two disagree.

## Summary

SquadSense can be built on free data alone. FPL gives us almost everything, including xG and xA.

- FPL is the core. Its public API has no key, includes Opta xG, xA and defensive contribution numbers, and anyone's squad can be read from a team ID. It has two catches. The exact bank, selling prices and free transfers come from `my-team`, which now needs a login. And the API can't be called straight from a browser, so we need a small server.
- Free outside data is thin, and we barely need it. FBref dropped its advanced stats in January 2026. Understat still has free xG. Odds and API-Football have small free quotas that only suit a once-a-day job.
- Family use means storing several team IDs with no user accounts. Only you would get the optional FPL login.

## 1. Platform and API access

### FPL public endpoints (no login)

All of these sit under `https://fantasy.premierleague.com/api/`, are GET requests and need a trailing slash. Without the slash you get a 301 with an empty body. All of them responded on 2 November 2026 ([sportsapis.dev](https://sportsapis.dev/fpl-api)).

| Endpoint | What it gives us | How we use it |
| --- | --- | --- |
| `bootstrap-static/` | Every player, club and gameweek, plus chips and game rules (about 1 MB). Player fields include price, price change, form, ownership, transfers in and out this gameweek, chance of playing, injury news, xG, xA, xGI, xGC, minutes, bonus, BPS and set-piece order. Club fields include home and away attack and defence strength. | The main daily pull. Feeds Price Watch and the model. |
| `fixtures/` (`?event=N`, `?future=1`) | All 380 fixtures with FPL's difficulty rating for each side, scores and match stats | Fixture Ticker and difficulty scores |
| `element-summary/{id}/` | One player's match-by-match history, remaining fixtures and past seasons | Form windows and minutes history |
| `event/{gw}/live/` | Points and stats for every player in one gameweek | Live scoring and storing results |
| `event-status/` | Whether points are still provisional and whether bonus has been added | Knowing when to finalize a gameweek |
| `entry/{team_id}/` | A manager's points, rank, team value and leagues | Family team cards |
| `entry/{team_id}/history/` | Points per gameweek, chips played, past seasons | Chip history, working out free transfers |
| `entry/{team_id}/event/{gw}/picks/` | The 15 picks, captain and bench order for that gameweek | My Squad (one gameweek behind until the deadline passes) |
| `entry/{team_id}/transfers/` | Every transfer made, with prices | Working out selling prices |
| `leagues-classic/{id}/standings/` | Mini-league table, 50 rows a page | Family league view |

### Your exact team state (login needed)

`my-team/{id}/` gives the real bank, selling prices, free transfers and pending transfers. It now returns 403 without a login. FPL signs in through OpenID Connect at account.premierleague.com. The endpoint wants an `X-Api-Authorization: Bearer` access token, so other tools store a refresh token rather than a password ([fantasypl/mcp #71](https://github.com/fantasypl/mcp/pull/71), [fpl-rank-solver #30](https://github.com/flusskrebs-max/fpl-rank-solver/pull/30)).

Here's what I recommend:

- Default, no login: rebuild the squad from `picks` and `transfers`. Work out each selling price from the purchase price, since you keep half of any rise, rounded down to £0.1m. Work out free transfers from `history`. That's accurate enough for family members.
- Optional, your account only: sign in once through the browser login, keep only the refresh token, encrypted on the server, and never send it to the browser. Treat it as read-only. The app never makes transfers.
- Confidence: about 70%. This login flow is unofficial and has changed before. If it breaks, the app falls back to the rebuilt squad.

### Rate limits, caching and refresh

- No published rate limit. About 70 calls, roughly one a second, got no 429 errors. I'd cap us at 1 request a second with backoff.
- `bootstrap-static` is cached for 5 minutes (`max-age=300`). Polling it more often just returns the same copy. Other endpoints say `no-store` but can still be up to about 10 minutes old.
- No browser access (no CORS). Every call has to go through our own server or scheduled job.
- Prices change once a day at about 00:00 UK time. Gameweek scores are now final at 09:00 UK the day after the last match, and live points are provisional until then ([Premier League](https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627)).
- Expect the 503 "game is updating" outage around deadlines and price changes. This is from community experience, not something I verified.

### Free outside sources

| Source | Free tier | Useful for | Verdict |
| --- | --- | --- | --- |
| FPL itself | Unlimited, in practice | Opta xG, xA, xGC, defensive contributions, injury news, chance of playing | Primary |
| [Understat](https://understat.com) | Free, no key; the data sits as JSON inside its pages | npxG, xGChain and shot data per player and per team for the top 6 leagues | Secondary model input. Scrape nightly and cache. |
| [API-Football](https://www.api-football.com/pricing) | 100 requests a day, 10 a minute, all endpoints | Injuries, lineups, odds | One cron job a day only |
| [The Odds API](https://the-odds-api.com/) | 500 credits a month; one call costs markets times regions | Match odds turned into clean-sheet and goal probabilities | Weekly, featured markets only |
| FBref | Basic stats only since January 2026 | Nothing advanced | Skip |
| Sportmonks | Free plan covers only Denmark and Scotland | Nothing | Skip |

Injury timelines (expected return dates) aren't available free anywhere I found. FPL's `news` and `chance_of_playing_next_round` fields are the best free signal.

## 2. Game rules and transfer logic

### Hard rules the engine must enforce (FPL 2026/27)

| Rule | Value | Where it comes from |
| --- | --- | --- |
| Squad | 15 players: 2 GK, 5 DEF, 5 MID, 3 FWD | [Beat FPL](https://www.beatfpl.com/guides/fpl-26-27-rules-changes) |
| Budget | £100.0m at the start; after that, bank plus total selling value | Same |
| Club limit | At most 3 players from one club | Same |
| Starting XI | 1 GK, at least 3 DEF, at least 2 MID, at least 1 FWD | Standard FPL rule; check against `game_settings` |
| Captain | Double points; the vice-captain takes over if the captain plays 0 minutes | Standard FPL rule |
| Free transfers | 1 a gameweek, bank up to 5, and they survive a Wildcard or Free Hit. No extra December transfers this season. | [Premier League](https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627) |
| Extra transfers | -4 points each | Standard FPL rule |
| Chips | Two sets of Wildcard, Free Hit, Triple Captain and Bench Boost. The first set must be used by the GW19 deadline (13:30 GMT, Sat 2 Jan) and doesn't carry over. One chip a gameweek. | [Premier League](https://www.premierleague.com/en/news/4679879/whats-happening-with-fpl-chips-in-202627) |
| Selling price | Purchase price plus half of any rise, rounded down to £0.1m | [OneFPL](https://onefpl.com/blog/how-fpl-price-changes-work) |
| Positions | 11 players were moved to a new position for 2026/27; always read the position from `element_type`, never hardcode it | [Premier League](https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627) |

We read these from `bootstrap-static` (`game_settings`, `chips`, `element_types`) wherever possible, so a mid-season rule change doesn't break the engine.

### When a -4 hit is worth it

Compare expected points (xP) over the planning window, not just next gameweek. A transfer is worth making when:

```latex
\sum_{t=1}^{H} \left( xP_{in,t} - xP_{out,t} \right) \cdot P(\text{starts})_t \; > \; 4 \cdot \text{hits} + V_{roll}
```

- H is the window, 3 to 5 gameweeks, with later weeks discounted (for example by 0.9 per week), because injuries and team news make them less certain.
- V_roll is what keeping the free transfer is worth. I'd start at about 1.5 points when you have 1 or 2 banked, falling to 0 at 5 banked, since a sixth is wasted. These numbers are my starting assumptions, not researched figures. We tune them against your past seasons.
- A hit to replace an injured or suspended starter gets judged against your best bench option playing instead, not against the injured player's expected points.
- The planner tries every sequence of 0 to 2 transfers per gameweek across the window and picks the path with the highest total xP after hits. That's how it decides whether to roll this week and double up next week.

### Price change signals

- How it works: prices move £0.1m at most once a day, at about 00:00 UK time, when net transfers pass a hidden threshold linked to ownership ([Premier League](https://www.premierleague.com/en/news/4680462/whats-new-in-202627-fantasy-price-change-predictor)). No player moves more than £0.3m in one gameweek, and Wildcard transfers don't count ([Fantasy Football Scout](https://www.fantasyfootballscout.co.uk/2026/07/20/how-do-fpl-price-changes-work)).
- The signals we track: `transfers_in_event` minus `transfers_out_event`, compared with ownership (`selected_by_percent` times total players). We also track the speed of change between our 15-minute snapshots, injury and news flags, and whether the player has already moved this gameweek.
- The official predictor shows progress percentages on the FPL site, but the PL hasn't documented any API field for it. If one turns up in `bootstrap-static` once we inspect it live, we use it. Otherwise we build our own estimate and tune it each night against the moves that actually happened.
- Confidence: about 60% that our predictor gets within a day of the real move, given the algorithm isn't public.

## 3. Scoring and prediction model

Each player gets an expected points (xP) figure per gameweek. Lineup, captain, transfers and chips all come from that one number. The weights below are my starting assumptions. We test them against last season's data (backtesting) before trusting them.

```latex
xP = P(60+) \cdot \left[ 2 + G_{pos} \cdot xG_{90} \cdot F_{att} + 3 \cdot xA_{90} \cdot F_{att} + CS_{pos} \cdot P(CS) + DC + B \right] + P(1\text{-}59) \cdot 1
```

Here G_pos and CS_pos are FPL's goal and clean-sheet points for the position, DC is expected defensive contribution points, B is expected bonus and F_att is the fixture multiplier. P(60+) is the chance he plays 60 minutes or more, and P(1-59) the chance he plays but less than an hour. We read the point values from `game_settings` rather than hardcoding them.

### Form vs season-long stats

- Use underlying rates, not raw points. xG, xA and defensive contributions per 90 minutes predict better than recent FPL points, which swing on single goals.
- Weight recent matches more, smoothly. Count each match less the older it is, so a match 6 matches ago counts half as much as the latest one. That replaces a hard "last 5 weeks" cut-off.
- Pull small samples toward a baseline. Early in the season, or for a player with few minutes, blend in last season's rate and a typical rate for his position. By about 900 minutes his own numbers take over.
- Recent FPL points get a small weight (10 to 20%) to catch role changes the stats miss, like a new penalty taker. Set-piece order from FPL feeds in directly.
- Bonus is estimated from BPS per 90. This season's BPS changes favor goalkeepers, full-backs and attackers ([Premier League](https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627)), so we only train on 2026/27 matches.

### Fixture difficulty over 3 to 5 gameweeks

FPL's 1 to 5 difficulty rating is too coarse, and it's the same number for attackers and defenders. We build two scores per fixture instead:

| Score | For | Built from |
| --- | --- | --- |
| Attack ease | MID and FWD | How many goals the opponent concedes in xG terms, plus a home or away adjustment, plus implied goals from the odds when we have them |
| Clean-sheet chance | GK and DEF | The opponent's xG plus home or away; P(CS) = e to the minus (expected goals against) |

- Window score = the sum across the next 3 to 5 gameweeks, with later weeks discounted. A blank gameweek counts 0 and a double counts both matches. That gives the Fixture Ticker its order.
- Team strength starts from FPL's `strength_attack_home` style fields and Understat team xG, updated as the season goes on.

### Risk flags

- Injury and doubt: `chance_of_playing_next_round` (0, 25, 50, 75 or 100), the `news` text and `news_added`. These set P(60+) directly.
- Rotation: share of possible minutes over the last 5 matches, starts compared with sub appearances, being taken off early, and midweek European or cup games 3 days or less before. We get those games from free ESPN data.
- Suspension: Premier League yellow-card bans come at 5 yellows within a club's first 19 league matches (1-match ban), 10 by the 32nd (2 matches) and 15 in the season (3 matches) ([FA](https://www.thefa.com/-/media/files/thefaportal/governance-docs/player-essentials/2026-27/essential-information-for-players-2026-27---english-version.ashx), [possible11](https://possible11.com/article/yellow-vs-red-cards-how-do-suspension-rules-work/)). Players on 4 or 9 yellows get flagged. The Champions League has its own count, and sources disagree on this season's threshold, so that needs checking before UEFA support goes in.
- Press-conference news: there's no free feed for it. FPL updates `news` within hours of a press conference, so we poll more often near deadlines (see Section 4). You can also set a manual override on any player ("out", "benched", "fit").

## 4. App architecture

I'd split it in two. Scheduled Python jobs fetch the data and run the model. A Next.js web app reads the stored results. Everything runs on free tiers.

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Data jobs and model | Python (httpx, pandas, PuLP for squad optimization) | The best libraries for squad optimization and stats; most FPL tooling is in Python |
| Scheduler | GitHub Actions cron (free) | No server to run. Runs can start a few minutes late, which is fine here. |
| Database | Postgres on Supabase free tier | Historical tables, a cache table and saved plans in one place |
| Web app | Next.js (TypeScript) installable on your phone (a PWA), Tailwind for styling | Fast on mobile. Its server routes get around FPL blocking direct browser calls. |
| Hosting | Vercel hobby tier | Free for personal, non-commercial use, which covers family use |
| Alerts | Web push from the PWA, or a Telegram bot | Both free; Telegram is more reliable on iPhone |

The phone only ever talks to our database. It never calls FPL directly, so pages load fast and rate limits stay out of the picture.

### Storage and caching

- Raw cache: every API response is saved with its URL, fetch time and a checksum. Jobs skip fetches while the cache is still fresh. This also lets us rerun the model on old data.
- Tables we build from it: `players`, `teams`, `fixtures`, `player_gw_stats` (one row per player per gameweek), `price_snapshots`, `predictions` (player, gameweek, xP, model version), `managers` (the family's team IDs) and `plans` (saved transfer scenarios).
- Past seasons: load the community archive (the vaastav/Fantasy-Premier-League GitHub repo, which I haven't checked this session) plus Understat history. We need these for backtesting.

| Job | When | Calls |
| --- | --- | --- |
| Core sync (bootstrap, fixtures) | Hourly; every 15 min from 21:00 to 00:30 UK | About 2 a run |
| Player histories | Once a day after the price change, plus after each gameweek is final | About 700, at 1 a second |
| Family squads | After each deadline, plus on demand | About 4 per team |
| Live points | Every 5 min while matches are on | 1 to 2 |
| Understat, odds, API-Football | Once a day (odds weekly) | Within the free quotas |
| Model and alerts | After each sync | None |

### Dashboard views

1. My Squad: your pitch view with xP, flags and selling prices, and a switcher for family teams.
2. Captain Picker: your top 5 captain options by xP, with a safety rating based on minutes risk.
3. Transfer Planner: a 3 to 5 gameweek sandbox. Drag players in and out, and it shows bank, club limits, hits and the xP difference live before you confirm anything on FPL.
4. Fixture Ticker: separate attack and defence views, sorted by window score, with blanks and doubles marked.
5. Price Watch: likely risers and fallers tonight, with your squad and watchlist pinned to the top.
6. Chip Planner: the best gameweek for each remaining chip, with a countdown to the GW19 deadline.
7. Player page: xG and xA trends, minutes, upcoming fixtures and news.

Alerts go out 24 hours and 2 hours before each deadline, around 22:00 for price moves on your players, and whenever there's injury news on a player you own.

Data flow (a diagram in the original doc): FPL API, Understat and odds/API-Football feed a GitHub Actions cron job (fetch and cache, build tables, run the xP model, queue alerts, 1 request a second). The job writes to Supabase Postgres (raw cache, stats and predictions, plans and managers). The Next.js PWA and the alerts read from the database. All outside calls happen in the scheduled jobs.

## 5. Questions for Clement

These were the open questions at the time. `CLAUDE.md` has his answers.

- [ ] What are the FPL team IDs: yours and the family's? The ID is in the URL of your Points page.
- [ ] Should your account use the optional FPL login (exact bank and selling prices), or should we only rebuild it from public data like everyone else's?
- [ ] How do you like to play: template-safe or chasing differentials? How many -4 hits a season are you comfortable with? Should the window default to 3 or 5 gameweeks?
- [ ] How should alerts reach you: phone push, Telegram or email?
- [ ] Are you comfortable with Python for the jobs and TypeScript for the app, or would you rather use one language? Do you already have GitHub, Vercel and Supabase accounts?
- [ ] Should backtesting use your own past FPL seasons, so we can measure the model against the decisions you actually made?

## Sources

- [FPL API endpoints, fields and caching (sportsapis.dev)](https://sportsapis.dev/fpl-api)
- [All you need to know about changes to FPL for 2026/27 (Premier League)](https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627)
- [What's happening with FPL chips in 2026/27 (Premier League)](https://www.premierleague.com/en/news/4679879/whats-happening-with-fpl-chips-in-202627)
- [Price Change Predictor (Premier League)](https://www.premierleague.com/en/news/4680462/whats-new-in-202627-fantasy-price-change-predictor)
- [FPL 2026/27 rule changes (Beat FPL)](https://www.beatfpl.com/guides/fpl-26-27-rules-changes)
- [How FPL price changes work (Fantasy Football Scout)](https://www.fantasyfootballscout.co.uk/2026/07/20/how-do-fpl-price-changes-work)
- [How FPL price changes work (OneFPL)](https://onefpl.com/blog/how-fpl-price-changes-work)
- [FPL login and my_team (fantasypl/mcp #71)](https://github.com/fantasypl/mcp/pull/71)
- [my-team returns 403 without login (fpl-rank-solver #30)](https://github.com/flusskrebs-max/fpl-rank-solver/pull/30)
- [FBref advanced stats removed (The IX)](https://www.theixsports.com/the-ix-soccer/fbrefs-loss-advanced-stats-womens-soccer-data-accessibility/)
- [API-Football pricing](https://www.api-football.com/pricing)
- [The Odds API](https://the-odds-api.com/)
- [Free football API comparison (TheStatsAPI)](https://thestatsapi.com/blog/free-football-api-alternatives)
- [FA Essential Information for Players 2026-27](https://www.thefa.com/-/media/files/thefaportal/governance-docs/player-essentials/2026-27/essential-information-for-players-2026-27---english-version.ashx)
- [Yellow card suspension rules (possible11)](https://possible11.com/article/yellow-vs-red-cards-how-do-suspension-rules-work/)
