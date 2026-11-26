-- ALTITUDE leaderboard update
-- Run this once in the Supabase SQL Editor before deploying the updated app.

alter table public.leaderboard
  add column if not exists team_name text not null default 'Solo';

alter table public.leaderboard
  add column if not exists total_time_ms integer not null default 0;

alter table public.leaderboard
  add column if not exists total_time_seconds numeric(8,2) not null default 0;

create index if not exists leaderboard_fastest_time_idx
  on public.leaderboard (total_time_ms asc, score desc, created_at asc);
