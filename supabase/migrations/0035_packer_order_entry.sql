-- Packers can enter orders (admin, 2026-10-14). The Order Entry screen
-- (/admin/orders) is open to the packer role so a packer can paste and save
-- orders, including creating a new customer inline and saving a new product
-- alias. Packers still never read prices: price_items / price_tiers stay
-- admin-only, and the server locks each line's price itself (see
-- src/app/actions/orders.ts) without sending it to the packer's screen.
--
-- Additive policies only; the admin policies are unchanged. Packers can
-- already update orders and insert order_lines (0007_packing_rls.sql), which
-- covers the same-day merge into an open order.

create policy "customers_insert_packer"
  on public.customers for insert
  with check (public.is_packer());

create policy "orders_insert_packer"
  on public.orders for insert
  with check (public.is_packer());

create policy "product_aliases_insert_packer"
  on public.product_aliases for insert
  with check (public.is_packer());
