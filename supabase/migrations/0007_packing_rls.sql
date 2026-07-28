-- Slice 6: packer write access. No new tables -- order_lines already has
-- everything packing needs (actual_qty, line_status, is_substitution,
-- substituted_for_line_id) from 0005_orders.sql. Adds is_packer() (mirrors
-- is_admin() in 0001_profiles.sql) and packer-scoped insert/update
-- policies. Existing admin policies from 0005_orders.sql are untouched --
-- RLS policies for the same command OR together, so admin keeps full
-- access alongside this new packer grant. Select already works for packer
-- via the existing has_role() policies.

create function public.is_packer()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'packer'
  );
$$;

create policy "orders_update_packer"
  on public.orders for update
  using (public.is_packer())
  with check (public.is_packer());

create policy "order_lines_update_packer"
  on public.order_lines for update
  using (public.is_packer())
  with check (public.is_packer());

create policy "order_lines_insert_packer"
  on public.order_lines for insert
  with check (public.is_packer());
