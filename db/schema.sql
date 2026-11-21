-- SquadSense database tables. Paste this into the Supabase SQL editor once.
-- The Python jobs write to these tables; the website only reads snapshots.

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

-- Expected points per player per gameweek. model_version lets us compare
-- old and new versions of the model when backtesting.
-- Each player's totals from past seasons, used as his starting point in the model.
create table if not exists player_past (
  player_id integer primary key,
  seasons jsonb not null,
  fetched_at timestamptz not null default now()
);

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

-- Lock every table down. Only the jobs (using the database password) and
-- the website's server code (using the service role key) can read or write.
-- Nothing is readable straight from a browser.
alter table api_cache enable row level security;
alter table player_history enable row level security;
alter table player_past enable row level security;
alter table predictions enable row level security;
alter table price_snapshots enable row level security;
alter table snapshots enable row level security;
