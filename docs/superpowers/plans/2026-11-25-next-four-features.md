# Next four features: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync watchdog, double gameweeks in chip timing, a shared watchlist with a rising alert, then family teams.

**Architecture:** Tasks 1-3 touch separate files and run in parallel (Task 1 here; 2 and 3 each in their own git worktree). Task 4 starts after they merge.

**Tech Stack:** Postgres (pg_cron, pg_net, Vault), Python 3 + pytest, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-11-25-next-four-features-design.md`

## Global Constraints

- Every comment, docstring, doc and commit message passes `../../Tools/humanizer-checker/checker.py`; no em dashes; American English.
- No secret, email address or key in any committed file: the repository is public.
- Supabase changes are applied only by the main session through the connector.
- jobs/ changes are test-first (pytest); web/ changes keep `npm test` and `npx tsc --noEmit` passing.

## Review Focus

- Watchdog: a night gap of 5.5 hours must not alert; one email per problem per 6 hours.
- Double weight: a half with no known double behaves exactly as today.
- Watchlist: a browser with blocked storage and no Supabase still works (as today).
- Watchlist alert: once per player per night; nothing when the watchlist is empty.
- Family: Clement's own pages and alerts unchanged when `FPL_TEAM_IDS` has one id.

---

### Task 1: Sync watchdog (`db/sync-watchdog.sql`)
- [ ] Function `check_sync_health()`, table `watchdog_state`, hourly `pg_cron` job, Resend via `pg_net` with Vault secrets `resend_api_key`, `alert_email_to`, `alert_email_from`.
- [ ] Test with SQL: stale snapshot and refused dispatch raise a problem; a fresh snapshot doesn't; a second check within 6 hours doesn't send again.
- [ ] README and CLAUDE.md.

### Task 2: Double gameweeks (`strategy.py`, `chip_backtest.py`, `plan_backtest.py`)
- [ ] Test: a known double raises BB and TC keep values by `DOUBLE_WEIGHT`; no double, no change.
- [ ] Backtest weights 1.0, 1.2, 1.4, 1.6; keep the best only if it beats 1.0; write up in `docs/backtest-results.md`.

### Task 3: Watchlist (`web/lib/watchlist.ts`, `/api/watchlist`, `alerts.py`, `storage.py`)
- [ ] Table `watchlist(team_id, player_id, added_at)`.
- [ ] API and hook with browser fallback and one-time move of local items.
- [ ] Test: `watch_rise_alert` once per player per night, nothing for an empty list.

### Task 4: Family teams (after 1-3 merge; needs team ids, names and emails)
- [ ] `api_cache` clean-up on the nightly run, test-first.
- [ ] Sync loop over `FPL_TEAM_IDS`, `team_members` table, per-team alerts and push.
- [ ] Team picker cookie and per-team reads on the website.
