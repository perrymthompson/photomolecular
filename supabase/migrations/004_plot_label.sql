-- User-defined condition label shown on plots (e.g. "Dark", "Light, 45°").
-- Distinct from `label`, which is the channel prefix from the filename (ch1, amb, …).

alter table public.trials
  add column if not exists plot_label text not null default '';
