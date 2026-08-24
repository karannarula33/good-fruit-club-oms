-- Packing screen: record what physical box/packet each packed line went
-- into. `order_packages` is one row per physical box/packet on an order --
-- not per-line -- because multiple order_lines can share one (the packer
-- may put several items in a single Big Box, or give each its own). A line
-- with no package_id simply hasn't had packaging recorded; this is
-- optional, same spirit as other packing fields that only demand attention
-- when set. RLS mirrors 0007_packing_rls.sql's admin+packer write access,
-- select mirrors the has_role() pattern from 0005_orders.sql.

create table public.order_packages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  packaging_type text not null check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'big_packet', 'tiny_box'
  )),
  created_at timestamptz not null default now()
);

alter table public.order_lines
  add column package_id uuid references public.order_packages (id);

alter table public.order_packages enable row level security;

create policy "order_packages_select_any_role"
  on public.order_packages for select
  using (public.has_role());

create policy "order_packages_insert_admin_packer"
  on public.order_packages for insert
  with check (public.is_admin() or public.is_packer());

create policy "order_packages_update_admin_packer"
  on public.order_packages for update
  using (public.is_admin() or public.is_packer())
  with check (public.is_admin() or public.is_packer());
