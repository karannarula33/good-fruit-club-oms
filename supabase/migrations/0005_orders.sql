-- Slice 4: orders + order_lines. RLS mirrors the has_role()/is_admin()
-- pattern from 0002_catalog_prices.sql / 0004_customers.sql.
--
-- orders.notes is additive beyond CLAUDE.md §4's literal schema: the order
-- parser contract (§5) has a top-level "notes" field ("never drop text")
-- with no other home -- order_lines.parse_note only covers per-line notes.
--
-- order_lines.locked_price_per_unit is deliberately nullable (no not-null
-- in §4): an order line whose product has no resolvable price can still be
-- saved -- the §3.2 guard blocks it at billing time, not at order entry.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  placed_at timestamptz not null,
  delivery_date date not null,
  status text not null default 'recorded' check (status in (
    'recorded', 'packed', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled'
  )),
  status_timestamps jsonb not null default '{}',
  raw_paste text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  product_id uuid references public.products (id),
  ordered_qty numeric(8, 3),
  ordered_unit text,
  locked_price_per_unit numeric(10, 2),
  actual_qty numeric(8, 3),
  line_status text not null default 'pending' check (line_status in ('pending', 'packed', 'unavailable')),
  is_substitution boolean not null default false,
  substituted_for_line_id uuid references public.order_lines (id),
  parse_confidence text check (parse_confidence in ('clean', 'flagged')),
  parse_note text
);

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy "orders_select_any_role"
  on public.orders for select
  using (public.has_role());

create policy "orders_insert_admin"
  on public.orders for insert
  with check (public.is_admin());

create policy "orders_update_admin"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "order_lines_select_any_role"
  on public.order_lines for select
  using (public.has_role());

create policy "order_lines_insert_admin"
  on public.order_lines for insert
  with check (public.is_admin());

create policy "order_lines_update_admin"
  on public.order_lines for update
  using (public.is_admin())
  with check (public.is_admin());
