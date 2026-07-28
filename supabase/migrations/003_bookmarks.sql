-- Time-stamped bookmarks (notes at specific clock times during a trial).
-- Run in Supabase SQL Editor if Dashboard "Add bookmark" fails with a column error.

alter table public.trials
  add column if not exists bookmarks jsonb not null default '[]'::jsonb;
