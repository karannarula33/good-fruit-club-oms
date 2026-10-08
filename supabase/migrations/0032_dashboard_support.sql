-- Dashboard v2 support (admin request 2026-10-08).
--
-- 1. products.category -- product grouping for the dashboard's category mix
--    (follows the website's categories; products not on the site get the
--    nearest one). Nullable: uncategorised products show as such.
-- 2. customers.is_internal -- staff / family accounts (e.g. "Kapoor's") that
--    the P&L excludes entirely. Replaces the name list in
--    COGS/internal_customers.json for the app.
-- 3. overhead_entries -- costs that belong to a DAY, not to an order: ad spend,
--    COD remittance fees, Mover minimum guarantees and the like. The dashboard
--    subtracts them from contribution for "Net after overheads". Packer wages
--    are NOT entered here: they are already spread onto order lines as
--    order_lines.actual_labour_cost.
--
-- Additive only; safe to run once. Seed data (categories, the internal flag,
-- existing overheads) is loaded separately by script.

alter table public.products add column if not exists category text;
alter table public.customers add column if not exists is_internal boolean not null default false;

create table if not exists public.overhead_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  category text not null check (category in ('ads', 'day_level', 'other')),
  amount numeric(10, 2) not null check (amount >= 0),
  note text,
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists overhead_entries_entry_date_idx on public.overhead_entries (entry_date);

alter table public.overhead_entries enable row level security;

create policy "overhead_entries_select_admin"
  on public.overhead_entries for select
  using (public.is_admin());
create policy "overhead_entries_write_admin"
  on public.overhead_entries for all
  using (public.is_admin())
  with check (public.is_admin());
