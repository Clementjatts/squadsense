-- The sync schedule. GitHub's own timer skipped most runs (4 or 5 of 13 a
-- day in November 2026), so Supabase keeps time instead: pg_cron starts a
-- job at each time, and the job asks GitHub to run the Sync FPL data
-- workflow straight away through its API (pg_net sends the request).
--
-- Before running this, save a GitHub fine-grained token in Supabase Vault
-- under the name github_sync_token. It needs access to the squadsense
-- repository only, with "Actions: read and write".
--
-- Checking it works:
--   select * from cron.job;  (the three timers)
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, content from net._http_response order by id desc limit 10;
-- GitHub answers 204 when it accepted the run.
-- Times are UTC, like the old GitHub schedule.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Asks GitHub to start the sync workflow. `full_refresh` also refreshes players
-- whose club played in the last 36 hours (the nightly run). Fails with a
-- clear message when the token hasn't been saved in Vault yet.
create or replace function public.start_sync(full_refresh boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_sync_token';
  if token is null then
    raise exception 'No github_sync_token in Supabase Vault, so the sync was not started';
  end if;
  return net.http_post(
    url := 'https://api.github.com/repos/Clementjatts/squadsense/actions/workflows/sync.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'squadsense-scheduler'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('full', full_refresh::text))
  );
end;
$$;

-- Only the database's own admin role (which pg_cron uses) may start a sync;
-- the website's API keys can't.
revoke all on function public.start_sync(boolean) from public, anon, authenticated;

-- The three timers. cron.schedule replaces a job with the same name, so
-- running this file again is safe.
select cron.schedule('sync-daytime', '17 7-21/2 * * *', $$select public.start_sync(false)$$);
select cron.schedule('sync-before-price-change', '15,45 22-23 * * *', $$select public.start_sync(false)$$);
select cron.schedule('sync-nightly-full', '37 1 * * *', $$select public.start_sync(true)$$);
