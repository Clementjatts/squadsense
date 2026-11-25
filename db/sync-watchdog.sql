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
-- syncs are running again. The emails use the same HTML layout and colors
-- as the sync's own alerts, with a plain-text copy.
--
-- Emails go through Resend. Before running this file, add three secrets in
-- Supabase Vault: resend_api_key, alert_email_to and alert_email_from (for
-- example "SquadSense <alerts@your-domain>"). They stay out of this file,
-- since the repository is public. Run db/sync-schedule.sql first.
--
-- Checking it (select public.send_watchdog_email('test') sends a test email):
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

-- Text made safe to put inside HTML.
create or replace function public.html_escape(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(value, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- What each watchdog email says: its title, message, highlighted note and button.
create or replace function public.watchdog_content(kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case kind
    when 'refused' then jsonb_build_object(
      'subject', 'SquadSense: GitHub refused to start the sync',
      'title', 'Syncs have stopped: GitHub refused the last request',
      'message', 'Supabase asked GitHub to start the SquadSense sync, and GitHub said no. The usual cause is an expired GitHub token.',
      'note', 'Until this is fixed, plans and alerts aren''t updated, so check the FPL site yourself before the deadline.',
      'steps', 'Make a new fine-grained token for the squadsense repository with Actions set to Read and write (README step 4), and save it in Supabase Vault as github_sync_token.',
      'label', 'Open GitHub tokens',
      'url', 'https://github.com/settings/personal-access-tokens')
    when 'stale' then jsonb_build_object(
      'subject', 'SquadSense: no new data for over 3 hours',
      'title', 'Syncs have stopped: no new data',
      'message', 'SquadSense hasn''t saved new data for over 3 hours (8 overnight), so the latest run probably failed or never started.',
      'note', 'Until this is fixed, plans and alerts aren''t updated, so check the FPL site yourself before the deadline.',
      'steps', 'Open the Actions tab on GitHub and look at the latest "Sync FPL data" run. Its log says what went wrong.',
      'label', 'Open GitHub Actions',
      'url', 'https://github.com/Clementjatts/squadsense/actions')
    when 'recovered' then jsonb_build_object(
      'subject', 'SquadSense: syncs are running again',
      'title', 'Syncs are running again',
      'message', 'New data arrived and the syncs are back on schedule. Plans and alerts are up to date again.',
      'note', null,
      'steps', 'Nothing to do.',
      'label', 'Open SquadSense',
      'url', 'https://squadsense.clementadegbenro.com/')
    when 'test' then jsonb_build_object(
      'subject', 'SquadSense: watchdog test',
      'title', 'The sync watchdog is on',
      'message', 'This is a test from the sync watchdog. If it reached you, warnings about stopped syncs will too.',
      'note', null,
      'steps', 'Nothing to do.',
      'label', 'Open SquadSense',
      'url', 'https://squadsense.clementadegbenro.com/')
  end;
$$;

-- The HTML email, in the same layout and colors as the sync's alerts (jobs/squadsense/email_template.py).
create or replace function public.watchdog_html(content jsonb, sent_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'
    || public.html_escape(content->>'title') || '</title></head>'
    || '<body style="margin:0;padding:0;background:#0B1220;font-family:Inter,-apple-system,''Segoe UI'',Helvetica,Arial,sans-serif">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1220"><tr><td align="center" style="padding:24px 12px">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">'
    || '<tr><td style="padding:0 4px 12px"><span style="color:#B7F34A;font-size:13px;font-weight:700;letter-spacing:0.12em">SQUADSENSE</span>'
    || '<h1 style="margin:6px 0 0;color:#E8EDF7;font-size:22px;line-height:1.25">' || public.html_escape(content->>'title') || '</h1></td></tr>'
    || '<tr><td style="background:#16213A;border:1px solid #26324D;border-radius:10px;padding:20px">'
    || '<p style="margin:0;color:#E8EDF7;font-size:15px;line-height:1.5">' || public.html_escape(content->>'message') || '</p>'
    || '<p style="margin:14px 0 0;color:#9AA6BF;font-size:14px;line-height:1.5"><b style="color:#E8EDF7">What to do:</b> ' || public.html_escape(content->>'steps') || '</p>'
    || coalesce('<p style="margin:16px 0 0;padding:10px 12px;border-left:3px solid #FFA24C;background:#0B1220;color:#E8EDF7;font-size:14px">'
                || public.html_escape(content->>'note') || '</p>', '')
    || '<p style="margin:22px 0 0"><a href="' || public.html_escape(content->>'url') || '" style="display:inline-block;background:#B7F34A;color:#0B1220;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:6px">'
    || public.html_escape(content->>'label') || '</a></p></td></tr>'
    || '<tr><td style="padding:14px 4px 0;color:#9AA6BF;font-size:12px;line-height:1.5">Sent by the SquadSense sync watchdog at '
    || to_char(sent_at at time zone 'Europe/London', 'HH24:MI') || ' UK. It checks once an hour that the syncs are running.</td></tr>'
    || '</table></td></tr></table></body></html>';
$$;

-- The plain-text copy, for mail apps that don't show HTML.
create or replace function public.watchdog_text(content jsonb, sent_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(E'\n\n',
    content->>'title', content->>'message', 'What to do: ' || (content->>'steps'), content->>'note',
    (content->>'label') || ': ' || (content->>'url'),
    'Sent by the SquadSense sync watchdog at ' || to_char(sent_at at time zone 'Europe/London', 'HH24:MI') || ' UK.');
$$;

-- Sends one watchdog email (HTML with a plain-text copy) through Resend.
-- Without the Vault secrets it raises a warning (shown in
-- cron.job_run_details) rather than failing quietly.
create or replace function public.send_watchdog_email(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key');
  email_to text := (select decrypted_secret from vault.decrypted_secrets where name = 'alert_email_to');
  email_from text := (select decrypted_secret from vault.decrypted_secrets where name = 'alert_email_from');
  content jsonb := public.watchdog_content(kind);
begin
  if api_key is null or email_to is null or email_from is null then
    raise warning 'Sync watchdog: add resend_api_key, alert_email_to and alert_email_from to Supabase Vault to get emails. Not sent: %', content->>'subject';
    return;
  end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', email_from, 'to', jsonb_build_array(email_to), 'reply_to', email_to,
      'subject', content->>'subject',
      'html', public.watchdog_html(content, now()),
      'text', public.watchdog_text(content, now()))
  );
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
    perform public.send_watchdog_email(problem);
    update public.watchdog_state set problem = check_sync_health.problem, alerted_at = now() where id = 1;
  elsif problem is null and state.problem is not null then
    perform public.send_watchdog_email('recovered');
    update public.watchdog_state set problem = null, alerted_at = now() where id = 1;
  end if;
  return problem;
end;
$$;

revoke all on function public.sync_problem_at(timestamptz, integer, timestamptz), public.sync_problem(),
  public.html_escape(text), public.watchdog_content(text), public.watchdog_html(jsonb, timestamptz),
  public.watchdog_text(jsonb, timestamptz), public.send_watchdog_email(text), public.check_sync_health()
  from public, anon, authenticated;

-- Hourly, five minutes past, clear of the syncs' own start times.
select cron.schedule('sync-watchdog', '5 * * * *', $$select public.check_sync_health()$$);
