-- Photomolecular chamber sensor trials
-- Run in Supabase SQL editor (or via supabase db push)

create extension if not exists "pgcrypto";

create table if not exists public.trials (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  filename text not null,
  notes text not null default '',
  session_start_time text, -- HH:MM:SS on the trial's data date
  date_label text,
  storage_path text not null unique,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trials_uploaded_at_idx on public.trials (uploaded_at desc);

-- Storage bucket (create via dashboard if this fails on hosted projects)
insert into storage.buckets (id, name, public)
values ('chamber-csvs', 'chamber-csvs', false)
on conflict (id) do nothing;

-- Service role bypasses RLS; for anon browser uploads you'd add policies.
alter table public.trials enable row level security;

create policy "Public read trials"
  on public.trials for select
  using (true);

create policy "Public insert trials"
  on public.trials for insert
  with check (true);

create policy "Public update trials"
  on public.trials for update
  using (true);

create policy "Public delete trials"
  on public.trials for delete
  using (true);
