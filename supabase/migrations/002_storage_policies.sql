-- Storage RLS policies for chamber-csvs bucket
-- Run in Supabase SQL Editor if browser/API uploads fail with
-- "new row violates row-level security policy"

-- Allow API uploads and downloads for the chamber-csvs bucket
create policy "Allow read chamber csvs"
  on storage.objects for select
  using (bucket_id = 'chamber-csvs');

create policy "Allow insert chamber csvs"
  on storage.objects for insert
  with check (bucket_id = 'chamber-csvs');

create policy "Allow delete chamber csvs"
  on storage.objects for delete
  using (bucket_id = 'chamber-csvs');
