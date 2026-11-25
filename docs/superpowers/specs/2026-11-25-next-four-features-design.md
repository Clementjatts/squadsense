# Next four features: design

25 November 2026. From the review Clement shared, in the order agreed.

## 1. Sync watchdog: an email when the syncs stop

**Why.** Every alert comes from the sync itself, so if GitHub fails, the
token expires or Supabase's timer stops, nothing tells Clement.

**Design.**
- A Supabase function `check_sync_health()` run by `pg_cron` every hour.
- It raises a problem when:
  - the latest snapshot is over 3 hours old between 07:00 and 23:59 UTC,
    or over 8 hours old at any time (the night gap is about 5.5 hours);
  - GitHub refused the last request to start a sync (answer not 204), which
    is what an expired or wrong token looks like.
- It emails through Resend with `pg_net`. The Resend key and both addresses
  live in Supabase Vault (`resend_api_key`, `alert_email_to`,
  `alert_email_from`), never in the SQL, since the repository is public.
- At most one email per problem every 6 hours (`watchdog_state` table), and
  one "Syncs are running again" email when it clears.
- Email only: phone notifications need the signing key the Python job holds.
- SQL in `db/sync-watchdog.sql`. Clement adds the three Vault secrets.

## 2. Double gameweeks in chip timing

**Why.** Our chip backtest: playing Bench Boost and Triple Captain in the
first double gameweek beat the current rule (17.7 against 14.5 points, and
14.0 against 12.8), over six half-seasons.

**Design.**
- In `strategy.py`, when the current half has a known double gameweek, Bench
  Boost's and Triple Captain's keep value counts that week's value times
  `DOUBLE_WEIGHT` (tried at 1.0, 1.2, 1.4 and 1.6), so playing them earlier
  needs a clearly better week.
- `chip_backtest.py` and `plan_backtest.py` decide the weight. If no weight
  beats today's rules, the setting stays at 1.0 (no change) and the result is
  written up in `docs/backtest-results.md` either way.

## 3. Watchlist on every device, and a "rising tonight" alert

**Design.**
- Table `watchlist(team_id, player_id, added_at)`; `/api/watchlist` (GET,
  PUT, DELETE); `web/lib/watchlist.ts` uses it, keeps the browser copy as a
  fallback, and moves what each browser already saved into the table the
  first time it opens.
- The sync reads the watchlist and sends "Watched player likely to rise
  tonight" once per player per night, with the same rule as the TONIGHT tag
  (to be revisited with the price audit).

## 4. Family teams, with database clean-up first

**Design.**
- **Clean-up** (on the nightly full run): delete `api_cache` rows that are
  no longer read: daily price predictions after 30 days, and rival picks,
  histories, plan caches, briefs and forecasts for gameweeks more than 3
  behind.
- **Sync.** `FPL_TEAM_IDS` (a list, Clement's first). Shared work runs once
  per sync (FPL data, player histories, the model); each team then gets its
  own squad, plan, leagues, review, snapshot and alerts.
- **Who gets what.** Table `team_members(team_id, name, email)`. Each team's
  emails go to its own address; push subscriptions gain a `team_id`, set from
  the team chosen when the bell is tapped.
- **Website.** Everyone signs in with the same site password, then picks
  their team once (remembered in a cookie, changeable from the header).
  Every page, Done on FPL, drafts and the watchlist use the chosen team.
  Apply to FPL stays Clement's only, on his Mac.

## Order and how it's built

1, 2 and 3 touch separate files, so they're built at the same time, each in
its own copy of the repository, then checked and merged. 4 comes after,
since it touches nearly everything. Supabase changes are applied by me.

## Needed from Clement

- For 1: the three Vault secrets (same steps as the GitHub token).
- For 4: each family member's FPL team ID, name and email address.
