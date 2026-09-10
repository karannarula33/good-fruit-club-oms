-- Go-forward cost capture for live orders (COGS, delivery cost, packaging
-- cost). order_lines.locked_cogs_per_unit (0013) and
-- actual_packaging_cost/actual_delivery_cost (0023) already exist as
-- landing spots -- nothing writes to them for live orders yet. This
-- migration adds the small source-of-truth audit tables these values get
-- applied from, kept separate from order_lines' derived per-line
-- allocation, same spirit as price_versions/price_items being preserved
-- rather than only applying and forgetting.
--
-- These are populated by scripts (apply_daily_cogs.ts,
-- apply_daily_delivery_costs.ts, apply_packaging_costs.ts), not an
-- in-app screen -- the owner shares the vendor's daily cost sheet and
-- delivery-cost sheet in chat, Claude reads/resolves them, and applies
-- via those scripts (dry-run first, same discipline as the historical
-- import). RLS below is for admin-driven review only; the scripts
-- themselves run as service role and bypass RLS entirely.

create table public.daily_cogs_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  product_id uuid not null references public.products (id),
  cost_per_unit numeric(10, 2) not null,
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (entry_date, product_id)
);

create table public.daily_delivery_hub_costs (
  entry_date date primary key,
  hub_cost numeric(10, 2) not null,
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.order_delivery_costs (
  order_id uuid primary key references public.orders (id),
  delivery_cost numeric(10, 2) not null,
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Box cost by physical packaging type -- same 6 values as
-- order_packages.packaging_type (0018_order_packaging.sql). Rarely
-- changes, so a flat table (not versioned like price_items) is enough;
-- effective_from is kept only so a future rate change doesn't silently
-- lose the prior value on update (admin should insert a fresh row rather
-- than overwrite, but nothing enforces that yet -- not needed until this
-- has a UI).
create table public.packaging_cost_config (
  packaging_type text primary key check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'big_packet', 'tiny_box'
  )),
  box_cost numeric(10, 2) not null,
  effective_from timestamptz not null default now()
);

-- Small scalar knobs for cost computation (misc-per-box, packer's monthly
-- wage). Mirrors eng_config's key/value shape (0013_engagement_engine.sql)
-- deliberately -- same "tunable without code changes" posture.
create table public.finance_config (
  key text primary key,
  value numeric not null,
  updated_at timestamptz default now()
);

alter table public.daily_cogs_entries enable row level security;
alter table public.daily_delivery_hub_costs enable row level security;
alter table public.order_delivery_costs enable row level security;
alter table public.packaging_cost_config enable row level security;
alter table public.finance_config enable row level security;

create policy "daily_cogs_entries_select_any_role"
  on public.daily_cogs_entries for select
  using (public.has_role());
create policy "daily_cogs_entries_write_admin"
  on public.daily_cogs_entries for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "daily_delivery_hub_costs_select_any_role"
  on public.daily_delivery_hub_costs for select
  using (public.has_role());
create policy "daily_delivery_hub_costs_write_admin"
  on public.daily_delivery_hub_costs for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "order_delivery_costs_select_any_role"
  on public.order_delivery_costs for select
  using (public.has_role());
create policy "order_delivery_costs_write_admin"
  on public.order_delivery_costs for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "packaging_cost_config_select_any_role"
  on public.packaging_cost_config for select
  using (public.has_role());
create policy "packaging_cost_config_write_admin"
  on public.packaging_cost_config for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "finance_config_select_any_role"
  on public.finance_config for select
  using (public.has_role());
create policy "finance_config_write_admin"
  on public.finance_config for all
  using (public.is_admin())
  with check (public.is_admin());
