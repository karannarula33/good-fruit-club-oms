-- Procurement UX redesign: replaces the day-level "mark list sent" moment
-- (procurement_marks, still in place but no longer read/written by the app)
-- with a per-item checklist. Checking an item snapshots the product's total
-- ordered qty for that delivery date into checked_qty; if more of that
-- product gets ordered afterward, the UI derives the delta
-- (current total - checked_qty) as a "+N new" badge on that row without
-- unchecking it. Un-checking simply deletes the row. Same RLS shape as
-- procurement_marks (has_role() for select, is_admin() for writes), except
-- writes also need update (checking is implemented as an upsert on
-- re-check).

create table public.procurement_item_checks (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  product_id uuid not null references public.products (id),
  checked_qty numeric(8,3) not null,
  checked_by uuid references public.profiles (id),
  checked_at timestamptz not null default now(),
  unique (delivery_date, product_id)
);

alter table public.procurement_item_checks enable row level security;

create policy "procurement_item_checks_select_any_role"
  on public.procurement_item_checks for select
  using (public.has_role());

create policy "procurement_item_checks_insert_admin"
  on public.procurement_item_checks for insert
  with check (public.is_admin());

create policy "procurement_item_checks_update_admin"
  on public.procurement_item_checks for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "procurement_item_checks_delete_admin"
  on public.procurement_item_checks for delete
  using (public.is_admin());
