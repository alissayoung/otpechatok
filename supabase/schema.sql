-- Отпечаток: таблица дней и публичное хранилище медиа.
-- Выполнить один раз в Supabase → SQL Editor.
-- Внимание: демо-режим без авторизации — любой с адресом сайта может читать и добавлять дни.

create table if not exists public.days (
  id text primary key,
  created_at timestamptz not null default now(),
  data jsonb not null
);

alter table public.days enable row level security;

drop policy if exists "days read" on public.days;
drop policy if exists "days insert" on public.days;
drop policy if exists "days update" on public.days;
create policy "days read" on public.days for select to anon, authenticated using (true);
create policy "days insert" on public.days for insert to anon, authenticated with check (true);
create policy "days update" on public.days for update to anon, authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('days', 'days', true)
on conflict (id) do nothing;

drop policy if exists "days media read" on storage.objects;
drop policy if exists "days media write" on storage.objects;
drop policy if exists "days media update" on storage.objects;
create policy "days media read" on storage.objects for select to anon, authenticated using (bucket_id = 'days');
create policy "days media write" on storage.objects for insert to anon, authenticated with check (bucket_id = 'days');
create policy "days media update" on storage.objects for update to anon, authenticated using (bucket_id = 'days') with check (bucket_id = 'days');
