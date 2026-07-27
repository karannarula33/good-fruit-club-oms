-- Slice 3: customers + zones. RLS mirrors the has_role()/is_admin() pattern
-- from 0002_catalog_prices.sql. 'Unassigned' is a sentinel for customers
-- whose address couldn't be matched to one of the real delivery zones at
-- import time -- it satisfies the not-null constraint per CLAUDE.md §4
-- without ever being treated as a real route zone (never appears in
-- ZONE_ORDER in src/lib/customers/zone.ts).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone text,
  address text not null,
  zone text not null check (zone in (
    'DLF Phase 2',
    'Sushant Lok',
    'Near Hamilton Court',
    'DLF Phase 1',
    'Phase 3',
    'Phase 4',
    'Phase 5',
    'Outside Gurgaon',
    'Unassigned'
  )),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

create policy "customers_select_any_role"
  on public.customers for select
  using (public.has_role());

create policy "customers_insert_admin"
  on public.customers for insert
  with check (public.is_admin());

create policy "customers_update_admin"
  on public.customers for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "customers_delete_admin"
  on public.customers for delete
  using (public.is_admin());
