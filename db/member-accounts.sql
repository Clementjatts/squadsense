-- Member accounts (25 November 2026): friends and family sign up with an
-- invite code, their FPL team ID and their own password. Run after
-- db/schema.sql, db/sync-schedule.sql and db/sync-watchdog.sql; it
-- replaces start_sync and the email layout functions defined there.
--
-- What it adds:
--   members                 which FPL team each Supabase Auth user has
--                           (also in db/schema.sql)
--   push_subscriptions.team_id   whose alerts each device gets
--   start_sync(full, team)  starts a sync for every team, or for one team
--   send_reset_email        the password reset email, in the alerts' layout

create table if not exists members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  team_id integer not null unique,
  name text not null,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  active boolean not null default true,
  emails boolean not null default true,
  created_at timestamptz not null default now()
);
alter table members enable row level security;
grant select, insert, update, delete on members to service_role;
revoke all on members from anon, authenticated;

alter table push_subscriptions add column if not exists team_id integer not null default 11304359;

-- Starts the sync workflow. With a team id it runs only that team (a new
-- member's first sync, or after their Done on FPL mark); without one it runs
-- every team. Each request is recorded for the watchdog.
create or replace function public.start_sync(full_refresh boolean default false, team_id integer default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  request bigint;
  inputs jsonb := jsonb_build_object('full', full_refresh::text);
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_sync_token';
  if token is null then
    raise exception 'No github_sync_token in Supabase Vault, so the sync was not started';
  end if;
  if team_id is not null then
    inputs := inputs || jsonb_build_object('team', team_id::text);
  end if;
  request := net.http_post(
    url := 'https://api.github.com/repos/Clementjatts/squadsense/actions/workflows/sync.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'squadsense-scheduler'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', inputs)
  );
  insert into public.sync_dispatches (request_id) values (request);
  return request;
end;
$$;
drop function if exists public.start_sync(boolean);
revoke all on function public.start_sync(boolean, integer) from public, anon, authenticated;
grant execute on function public.start_sync(boolean, integer) to service_role;

-- The email layout from db/sync-watchdog.sql, now with an optional
-- 'footer' so emails other than the watchdog's say who sent them.
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
    || '<tr><td style="padding:14px 4px 0;color:#9AA6BF;font-size:12px;line-height:1.5">'
    || public.html_escape(coalesce(content->>'footer', 'Sent by the SquadSense sync watchdog at '
         || to_char(sent_at at time zone 'Europe/London', 'HH24:MI') || ' UK. It checks once an hour that the syncs are running.'))
    || '</td></tr></table></td></tr></table></body></html>';
$$;

-- The plain-text copy, with the same optional footer.
create or replace function public.watchdog_text(content jsonb, sent_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(E'\n\n',
    content->>'title', content->>'message', 'What to do: ' || (content->>'steps'), content->>'note',
    (content->>'label') || ': ' || (content->>'url'),
    coalesce(content->>'footer', 'Sent by the SquadSense sync watchdog at ' || to_char(sent_at at time zone 'Europe/London', 'HH24:MI') || ' UK.'));
$$;

-- Reset emails sent, so they can be limited: one per address every 10
-- minutes and 20 a day in all, which keeps Resend's free 100 emails a day
-- for the deadline alerts. Rows older than two days are cleared as it goes.
create table if not exists public.reset_emails (
  address text not null,
  sent_at timestamptz not null default now()
);
create index if not exists reset_emails_sent_at on public.reset_emails (sent_at);
alter table public.reset_emails enable row level security;
revoke all on public.reset_emails from anon, authenticated;

-- True when a reset email to `address` at `at` would go over a limit.
create or replace function public.reset_email_limited(address text, at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.reset_emails r where r.address = lower(reset_email_limited.address) and r.sent_at > at - interval '10 minutes')
      or (select count(*) from public.reset_emails r where r.sent_at > at - interval '24 hours') >= 20;
$$;
revoke all on function public.reset_email_limited(text, timestamptz) from public, anon, authenticated;
grant execute on function public.reset_email_limited(text, timestamptz) to service_role;

-- The password reset email. The website makes a one-time link with
-- Supabase Auth and calls this, so the email comes from SquadSense's own
-- address through Resend (key in Vault) rather than Supabase's mail server.
-- Over a limit it sends nothing and says so in the database log; the page
-- tells the visitor the same thing either way.
create or replace function public.send_reset_email(email text, link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key');
  email_from text := (select decrypted_secret from vault.decrypted_secrets where name = 'alert_email_from');
  content jsonb := jsonb_build_object(
    'title', 'Reset your SquadSense password',
    'message', 'Someone asked to reset the password for this SquadSense account. If it was you, choose a new password with the button below. The link works for one hour.',
    'steps', 'If you didn''t ask for this, ignore this email: your password stays the same.',
    'note', null,
    'label', 'Choose a new password',
    'url', link,
    'footer', 'Sent by SquadSense because a password reset was asked for this email address.');
begin
  if api_key is null or email_from is null then
    raise exception 'Password reset email not sent: resend_api_key or alert_email_from is missing from Supabase Vault';
  end if;
  delete from public.reset_emails where sent_at < now() - interval '2 days';
  if public.reset_email_limited(email) then
    raise log 'Password reset email not sent: limit reached (one per address every 10 minutes, 20 a day)';
    return;
  end if;
  insert into public.reset_emails (address) values (lower(email));
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', email_from, 'to', jsonb_build_array(email),
      'subject', 'SquadSense: reset your password',
      'html', public.watchdog_html(content, now()),
      'text', public.watchdog_text(content, now()))
  );
end;
$$;
revoke all on function public.send_reset_email(text, text) from public, anon, authenticated;
grant execute on function public.send_reset_email(text, text) to service_role;
