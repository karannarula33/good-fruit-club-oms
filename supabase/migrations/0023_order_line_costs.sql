-- Historical/actual cost capture on order_lines. The Master Dashboard sheet
-- has recorded "Pkg Cost (actual)" and "Delivery (actual)" per order line
-- since day one, but the historical import (0013_engagement_engine.sql,
-- scripts/import_historical_orders.ts) never carried them over -- only
-- Sell Price and COGS were mapped. These are absolute per-line rupee
-- amounts as recorded in the sheet (they do not scale with qty, unlike
-- locked_price_per_unit/locked_cogs_per_unit), so they're named actual_*
-- to match actual_qty's "recorded fact" naming rather than the locked_*
-- "rate" naming.
--
-- Nullable: most live order_lines will stay null until a future
-- go-forward cost-capture feature exists (same posture locked_cogs_per_unit
-- already takes -- see 0013's header comment).
alter table public.order_lines
  add column if not exists actual_packaging_cost numeric(10, 2),
  add column if not exists actual_delivery_cost numeric(10, 2);

-- Custom gift boxes (first seen: sheet order #770, "Gift Packing", no
-- fixed recipe -- confirmed with the business owner these are composed
-- per-customer, not a catalog SKU). is_gift_box flags the order_line;
-- gift_box_contents optionally records what actually went in it and at
-- what cost, when that detail is known (never for historical rows, since
-- the sheet only ever recorded a lump sum). Shape mirrors order_packages
-- (0018_order_packaging.sql): one row per constituent item, RLS matches
-- its select-any-role / write-admin-or-packer split.
alter table public.order_lines
  add column if not exists is_gift_box boolean not null default false;

create table public.gift_box_contents (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines (id),
  product_id uuid not null references public.products (id),
  qty numeric(8, 3) not null,
  unit_cost numeric(10, 2) not null
);

alter table public.gift_box_contents enable row level security;

create policy "gift_box_contents_select_any_role"
  on public.gift_box_contents for select
  using (public.has_role());

create policy "gift_box_contents_insert_admin_packer"
  on public.gift_box_contents for insert
  with check (public.is_admin() or public.is_packer());

create policy "gift_box_contents_update_admin_packer"
  on public.gift_box_contents for update
  using (public.is_admin() or public.is_packer())
  with check (public.is_admin() or public.is_packer());

-- Fallback catalog product for gift-box order lines with no per-item
-- breakdown available (every historical row, and any live packer entry
-- that records a box without itemizing it in gift_box_contents). Fixed id
-- so the historical import (scripts/import_historical_orders.ts) can alias
-- the sheet's "Gift Packing" label to it deterministically below.
insert into public.products (id, name, unit_type, unit_label, active)
values ('9d9766d9-7f1a-4a12-8a79-643f1a4f66e7', 'Gift Box (Custom)', 'count', 'box', true)
on conflict (name) do nothing;

-- Three product-name gaps found while extending the historical import to
-- the fresh sheet export (2026-09-08 pull): "Pusa Mango" and "Bartlett
-- Pear" are sheet shorthand for existing catalog products (confirmed with
-- the business owner), and "Gift Packing" is the sheet's label for the
-- gift-box line above. Per CLAUDE.md §3.9 / the engagement engine's §12.2,
-- these belong in product_aliases so the live parser also benefits, not
-- just the one-off import script.
insert into public.product_aliases (alias, product_id) values
  ('Pusa Mango', '56bfff45-2d18-4637-94fa-c19000f062fb'),      -- -> Pusa Mango – 1 kg
  ('Bartlett Pear', '7d5e4016-42b7-4dde-ae34-135fac3ab266'),   -- -> Pears (generic)
  ('Gift Packing', '9d9766d9-7f1a-4a12-8a79-643f1a4f66e7')     -- -> Gift Box (Custom)
on conflict (alias) do nothing;
