# Reliable sync schedule: design

Short design, 24 November 2026.

## Why

GitHub's own schedule ran only 4 or 5 of the 13 syncs a day on 22 and 23
November, at odd times, and none of the four runs before the midnight
price change. The final call alert only goes out if a sync runs in the
2.5 hours before the deadline, and the price audit needs predictions saved
late in the evening. GitHub drops scheduled runs when it's busy, but it
starts a run straight away when asked through its API.

## Goals

- Every sync in the schedule starts within a minute or two of its time.
- Same times and the same nightly full run as today.
- Free, using services already in place.

## Non-goals and anti-goals

- No change to what a sync does.
- No double runs eating Actions minutes.
- No GitHub token in the code or the repository.

## Approaches

1. Supabase's scheduler (`pg_cron`) asks GitHub to start the workflow
   (`pg_net` posting to the workflow dispatch API). Chosen: Supabase is
   already the database, both extensions are free and available, and the
   token stays in Supabase's secret store (Vault).
2. A Cloudflare Worker on a timer: also free, but the Cloudflare connector
   is deprecated and it adds a third place to look after.
3. Vercel's timers: the free plan allows only one a day.

## The design

- Turn on `pg_cron` and `pg_net` in the squadsense Supabase project.
- Clement creates a fine-grained GitHub token for `Clementjatts/squadsense`
  only, with Actions read and write, and saves it in Supabase Vault as
  `github_sync_token`. Claude never sees it.
- A database function `start_sync(full boolean)` reads the token from
  Vault and posts `{"ref": "main", "inputs": {"full": ...}}` to
  `https://api.github.com/repos/Clementjatts/squadsense/actions/workflows/sync.yml/dispatches`.
  Only the database's own admin role can run it.
- Three `pg_cron` jobs in UTC, matching today's schedule: `17 7-21/2 * * *`,
  `15,45 22-23 * * *`, and `37 1 * * *` with `full` on.
- `sync.yml` loses its `schedule:` block (so runs aren't doubled) and gains
  a `concurrency` group, so a run that starts while another is going waits
  for it rather than both writing at once.
- The SQL lives in `db/sync-schedule.sql`, with how to check it
  (`cron.job_run_details` and `net._http_response`) in the README.

## Left to the builder

Function and job names, and the README wording.

## Known limits

- If Supabase is down, no sync starts; there's no fallback timer. The
  deadline calendar still reminds Clement.
- With every run happening, Actions use rises to the planned 900 to
  1,000 minutes a month (out of 2,000).
