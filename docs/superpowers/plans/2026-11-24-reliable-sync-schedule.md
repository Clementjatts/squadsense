# Reliable sync schedule: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase starts the GitHub sync at fixed times, replacing GitHub's unreliable schedule.

**Architecture:** `pg_cron` jobs call a database function that posts to GitHub's workflow dispatch API through `pg_net`, with the token read from Vault. `sync.yml` drops its schedule and gains a concurrency group.

**Tech Stack:** Postgres 17 on Supabase (`pg_cron` 1.6, `pg_net` 0.20, Vault), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-24-reliable-sync-schedule-design.md`

## Global Constraints

- Vault secret name `github_sync_token`; Clement adds it, Claude never reads or prints it.
- Dispatch URL `https://api.github.com/repos/Clementjatts/squadsense/actions/workflows/sync.yml/dispatches`, body `{"ref": "main", "inputs": {"full": "true"|"false"}}`.
- Jobs (UTC): `17 7-21/2 * * *`, `15,45 22-23 * * *`, `37 1 * * *` (full).
- GitHub's schedule is removed only after a Supabase-started run is seen on GitHub.

## Review Focus

- Missing token: the function raises a clear error, visible in `cron.job_run_details`.
- GitHub refuses (bad token, 401/403/404): visible in `net._http_response`.
- Two runs overlapping (late run plus the next one): the second waits.
- The nightly run is still a full run without `github.event.schedule`.
- `start_sync` can't be called through the website's API keys.

---

### Task 1: Database side (`db/sync-schedule.sql`)

- [ ] Write the file: extensions, `start_sync(full boolean)` (security definer, revoked from public, anon and authenticated), and the three `cron.schedule` calls.
- [ ] Apply extensions and the function through the Supabase connector (no jobs yet).
- [ ] Clement creates the token and saves it in Vault.
- [ ] Call `select start_sync(false)` once; check `net._http_response` shows 204 and a run appears on GitHub as `workflow_dispatch`.
- [ ] Schedule the three jobs; list them from `cron.job`.

### Task 2: Workflow and docs

- [ ] `sync.yml`: remove `schedule:`, add `concurrency: { group: sync, cancel-in-progress: false }`, update the header comment.
- [ ] README (hosting step 4) and CLAUDE.md (Scheduling line): where the timer lives and how to check it.
- [ ] `checker.py` on changed files; commit and push after Clement says so.
