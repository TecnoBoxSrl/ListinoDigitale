alter table public.products add column if not exists dimensione text;
alter table public.products add column if not exists conai numeric(12,4);
alter table public.products add column if not exists conai_per_collo numeric(12,4);

create table if not exists public.admin_change_batches (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('manual_update','partial_import')),
  label text,
  changed_by uuid references auth.users(id),
  item_count int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.admin_change_batches enable row level security;

create table if not exists public.admin_change_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admin_change_batches(id) on delete cascade,
  old_codice text,
  new_codice text not null,
  change_type text not null check (change_type in ('created','updated')),
  delta jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_change_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_change_batches' and policyname = 'admin_change_batches read admin') then
    create policy "admin_change_batches read admin" on public.admin_change_batches for select using ( public.is_admin(auth.uid()) );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_change_batches' and policyname = 'admin_change_batches write admin') then
    create policy "admin_change_batches write admin" on public.admin_change_batches for all using ( public.is_admin(auth.uid()) ) with check ( public.is_admin(auth.uid()) );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_change_items' and policyname = 'admin_change_items read admin') then
    create policy "admin_change_items read admin" on public.admin_change_items for select using ( public.is_admin(auth.uid()) );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_change_items' and policyname = 'admin_change_items write admin') then
    create policy "admin_change_items write admin" on public.admin_change_items for all using ( public.is_admin(auth.uid()) ) with check ( public.is_admin(auth.uid()) );
  end if;
end $$;

create index if not exists admin_change_batches_created_at_idx on public.admin_change_batches (created_at desc);
create index if not exists admin_change_items_batch_id_idx on public.admin_change_items (batch_id);
