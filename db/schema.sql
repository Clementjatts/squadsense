-- SquadSense database tables. Paste this into the Supabase SQL editor once
-- (it's safe to run again: nothing is created twice).
-- The Python jobs write to these tables; the website reads snapshots and,
-- for alerts, saves your devices' push subscriptions.

-- Latest copy of each FPL API response, so the model can be rerun on old data.
create table if not exists api_cache (
  path text primary key,
  body jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Match-by-match history for each player (from element-summary).
create table if not exists player_history (
  player_id integer primary key,
  rows jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Each player's totals from past seasons, used as his starting point in the model.
create table if not exists player_past (
  player_id integer primary key,
  seasons jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Expected points per player per gameweek. model_version lets us compare
-- old and new versions of the model when backtesting.
create table if not exists predictions (
  player_id integer not null,
  gameweek integer not null,
  model_version text not null,
  xp numeric(6, 2) not null,
  created_at timestamptz not null default now(),
  primary key (player_id, gameweek, model_version)
);

-- Price and transfer counts every time the job runs. The price change
-- predictor in the next build learns from this table.
create table if not exists price_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  player_id integer not null,
  now_cost integer not null,
  transfers_in_event integer not null,
  transfers_out_event integer not null,
  selected_by_percent numeric(5, 1) not null
);
create index if not exists price_snapshots_player_time on price_snapshots (player_id, taken_at desc);

-- Everything the website shows for one team, built by the job.
create table if not exists snapshots (
  id bigint generated always as identity primary key,
  team_id integer not null,
  gameweek integer not null,
  created_at timestamptz not null default now(),
  body jsonb not null
);
create index if not exists snapshots_team_latest on snapshots (team_id, created_at desc);

-- Alerts: each phone or browser that turned on notifications, one row per device.
create table if not exists push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- Alerts already sent, so the same one never goes out twice.
create table if not exists alerts_sent (
  alert_key text primary key,
  sent_at timestamptz not null default now()
);

-- Transfer Planner drafts (moves, chips, captains and lineups), shared
-- between your devices. "current" is saved as you plan; up to three more
-- are named scenarios to compare. Added 22 November 2026.
create table if not exists planner_drafts (
  team_id integer not null,
  name text not null,
  draft jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (team_id, name)
);

-- Transfers Clement marked "Done on FPL" on the website. FPL hides them
-- until the deadline, so the sync applies these to the public squad.
-- price_in is in tenths of a million, as shown when the move was marked.
create table if not exists made_moves (
  team_id integer not null,
  gameweek integer not null,
  player_out integer not null,
  player_in integer not null,
  price_in integer not null,
  made_at timestamptz not null default now(),
  primary key (team_id, gameweek, player_out)
);

-- Lock every table down. Only the jobs (using the database password) and
-- the website's server code (using the service role key) can read or write.
-- Nothing is readable straight from a browser.
alter table api_cache enable row level security;
alter table player_history enable row level security;
alter table player_past enable row level security;
alter table predictions enable row level security;
alter table price_snapshots enable row level security;
alter table snapshots enable row level security;
alter table push_subscriptions enable row level security;
alter table alerts_sent enable row level security;
alter table planner_drafts enable row level security;
alter table made_moves enable row level security;

-- The project was created with "grant API access to new tables" turned off,
-- so give the website's server key (service_role) what it needs, and make
-- sure the public browser roles get nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on all tables in schema public from anon, authenticated;
