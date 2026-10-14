-- Leftover-stock inventory (admin 2026-10-02). The packer records end-of-day
-- leftover stock per product; the next day's procurement nets it out
-- ("to procure = demand - leftover") so the team stops re-buying what's already
-- on hand -- cutting over-ordering and wastage (CLAUDE.md §3.6).
--
-- as_of_date = the end-of-day (IST) the count was taken. Each evening's count is
-- the authoritative current stock (fruit is perishable); procurement for a
-- delivery date uses the most recent count strictly before it. No multi-day
-- rollover / auto-decrement -- a fresh count supersedes. Only products with
-- leftover get a row; absence means none left. unique(as_of_date, product_id)
-- so re-saving a day's count upserts. RLS mirrors order_packages
-- (0018_order_packaging.sql): any role reads; admin or packer writes.
create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  product_id uuid not null references public.products (id),
  qty numeric(8, 3) not null,
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now(),
  note text,
  unique (as_of_date, product_id)
);

alter table public.inventory_snapshots enable row level security;

create policy "inventory_snapshots_select_any_role"
  on public.inventory_snapshots for select
  using (public.has_role());

create policy "inventory_snapshots_insert_admin_packer"
  on public.inventory_snapshots for insert
  with check (public.is_admin() or public.is_packer());

create policy "inventory_snapshots_update_admin_packer"
  on public.inventory_snapshots for update
  using (public.is_admin() or public.is_packer())
  with check (public.is_admin() or public.is_packer());

create policy "inventory_snapshots_delete_admin_packer"
  on public.inventory_snapshots for delete
  using (public.is_admin() or public.is_packer());
