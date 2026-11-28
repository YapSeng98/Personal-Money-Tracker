-- 008 — My notes, money owed to you, receipt photos, and saved searches on every device.
--
-- Safe to run more than once. Until it has run, the app keeps these on the
-- device and sends nothing that names the new columns, so nothing breaks.
--
--   transactions.owed_by       on an expense: who will pay it back ("Mei",
--                              "Company claim"). Claims expenses count as owed
--                              without it.
--   transactions.settles       on a payback: the expense it pays back, so a
--                              debt shows as settled (partly or fully).
--   transactions.receipt_path  where the receipt photo is kept in Storage:
--                              receipts/<your user id>/<transaction id>.jpg
--   preferences.saved_searches the searches saved on the Transactions page.

alter table public.transactions add column if not exists owed_by      text;
alter table public.transactions add column if not exists settles      uuid;
alter table public.transactions add column if not exists receipt_path text;
alter table public.preferences  add column if not exists saved_searches jsonb not null default '[]'::jsonb;

-- My notes: things to pay, collect or record later, on every device.
create table if not exists public.notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body        text not null default '',
  amount      numeric,
  currency    text,
  due_date    date,
  kind        text check (kind is null or kind in ('expense', 'income', 'transfer')),
  account     text,
  pinned      boolean not null default false,
  done_at     timestamp with time zone,
  txn_id      uuid,
  created_at  timestamp with time zone not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id);
alter table public.notes enable row level security;
drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;
create policy notes_select_own on public.notes for select to authenticated using (auth.uid() = user_id);
create policy notes_insert_own on public.notes for insert to authenticated with check (auth.uid() = user_id);
create policy notes_update_own on public.notes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy notes_delete_own on public.notes for delete to authenticated using (auth.uid() = user_id);

-- Receipt photos: a private bucket (no public links; the app asks for a link
-- that expires after an hour), 5 MB a file, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Each person reaches only the files in the folder named after their own id.
drop policy if exists receipts_select_own on storage.objects;
drop policy if exists receipts_insert_own on storage.objects;
drop policy if exists receipts_update_own on storage.objects;
drop policy if exists receipts_delete_own on storage.objects;
create policy receipts_select_own on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_update_own on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
