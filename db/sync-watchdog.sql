-- The sync watchdog: an email when the syncs stop. Every other alert comes
-- from the sync itself, so if GitHub fails, the token expires or the timer
-- stops, nothing else would say so. This runs inside Supabase, once an hour.
--
-- A problem is one of:
--   refused: GitHub didn't accept the last request to start a sync (an
--            expired or wrong token looks like this);
--   stale:   the latest snapshot is over 3 hours old between 09:00 and
--            23:59 UTC, or over 8 hours old at any time. The quiet night
--            gap (23:45 to 07:17, with a run at 01:37) stays under 8 hours,
--            and by 09:00 the 07:17 run has finished.
-- It emails at most once per problem every 6 hours, and once when the
-- syncs are running again.
--
-- Emails go through Resend. Before running this file, add three secrets in
-- Supabase Vault: resend_api_key, alert_email_to and alert_email_from (for
-- example "SquadSense <alerts@your-domain>"). They stay out of this file,
-- since the repository is public. Run db/sync-schedule.sql first.
--
-- Checking it:
--   select * from cron.job_run_details where command like '%check_sync_health%' order by start_time desc limit 5;
--   select * from watchdog_state;
--   select public.sync_problem_at(now() - interval '4 hours', 204, '2026-11-25 12:00+00');  (gives 'stale')

-- Each request start_sync sends, so the watchdog reads only GitHub's
-- answers, not the answers to its own emails.
create table if not exists sync_dispatches (
  request_id bigint primary key,
  sent_at timestamptz not null default now()
);

-- The watchdog's memory: the problem it last emailed about, and when.
create table if not exists watchdog_state (
  id integer primary key default 1 check (id = 1),
  problem text,
  alerted_at timestamptz
);
insert into watchdog_state (id) values (1) on conflict (id) do nothing;

alter table sync_dispatches enable row level security;
alter table watchdog_state enable row level security;
revoke all on sync_dispatches, watchdog_state from anon, authenticated;

-- start_sync again, now also recording each request it sends.
create or replace function public.start_sync(full_refresh boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  request bigint;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_sync_token';
  if token is null then
    raise exception 'No github_sync_token in Supabase Vault, so the sync was not started';
  end if;
  request := net.http_post(
    url := 'https://api.github.com/repos/Clementjatts/squadsense/actions/workflows/sync.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'squadsense-scheduler'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('full', full_refresh::text))
  );
  insert into public.sync_dispatches (request_id) values (request);
  return request;
end;
$$;

-- The rule itself, with its inputs passed in so it can be tested:
-- 'refused', 'stale' or null (all well). A null status means GitHub hasn't
-- answered yet, which isn't counted as refused.
create or replace function public.sync_problem_at(latest_snapshot timestamptz, last_status integer, at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when last_status is not null and last_status <> 204 then 'refused'
    when latest_snapshot is null or latest_snapshot < at - interval '8 hours' then 'stale'
    when extract(hour from at at time zone 'UTC') >= 9 and latest_snapshot < at - interval '3 hours' then 'stale'
    else null
  end;
$$;

-- The problem right now, from the latest snapshot and GitHub's answer to the last sync request.
create or replace function public.sync_problem()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.sync_problem_at(
    (select max(created_at) from public.snapshots),
    (select response.status_code from public.sync_dispatches dispatch
       join net._http_response response on response.id = dispatch.request_id
       order by dispatch.sent_at desc limit 1),
    now()
  );
$$;

-- Sends one plain-text email through Resend. Without the Vault secrets it
-- raises a warning (shown in cron.job_run_details) rather than failing quietly.
create or replace function public.send_watchdog_email(subject text, message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key');
  email_to text := (select decrypted_secret from vault.decrypted_secrets where name = 'alert_email_to');
  email_from text := (select decrypted_secret from vault.decrypted_secrets where name = 'alert_email_from');
begin
  if api_key is null or email_to is null or email_from is null then
    raise warning 'Sync watchdog: add resend_api_key, alert_email_to and alert_email_from to Supabase Vault to get emails. Not sent: %', subject;
    return;
  end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', email_from, 'to', jsonb_build_array(email_to), 'subject', subject, 'text', message)
  );
end;
$$;

-- What the emails say for each problem.
create or replace function public.watchdog_message(problem text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case problem
    when 'refused' then 'GitHub refused the last request to start a sync. The usual cause is an expired GitHub token: make a new fine-grained token (README step 4) and save it in Supabase Vault as github_sync_token. Until then, plans and alerts aren''t updated, so check the FPL site yourself before the deadline.'
    when 'stale' then 'No new SquadSense data for over 3 hours (8 overnight). Check the Actions tab on GitHub for a failed run. Until it''s fixed, plans and alerts aren''t updated, so check the FPL site yourself before the deadline.'
  end;
$$;

-- The hourly check: email about a new problem, repeat one every 6 hours, and say when it clears.
create or replace function public.check_sync_health()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  problem text := public.sync_problem();
  state public.watchdog_state;
begin
  select * into state from public.watchdog_state where id = 1;
  if problem is not null and (state.problem is distinct from problem or state.alerted_at < now() - interval '6 hours') then
    perform public.send_watchdog_email('SquadSense: syncs have stopped', public.watchdog_message(problem));
    update public.watchdog_state set problem = check_sync_health.problem, alerted_at = now() where id = 1;
  elsif problem is null and state.problem is not null then
    perform public.send_watchdog_email('SquadSense: syncs are running again', 'New data arrived and the syncs are back on schedule. Nothing to do.');
    update public.watchdog_state set problem = null, alerted_at = now() where id = 1;
  end if;
  return problem;
end;
$$;

revoke all on function public.sync_problem_at(timestamptz, integer, timestamptz), public.sync_problem(),
  public.send_watchdog_email(text, text), public.watchdog_message(text), public.check_sync_health()
  from public, anon, authenticated;

-- Hourly, five minutes past, clear of the syncs' own start times.
select cron.schedule('sync-watchdog', '5 * * * *', $$select public.check_sync_health()$$);
