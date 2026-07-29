-- Manage Orders: lets an admin delete a wrongly-entered/test order (or a
-- single line within one) before it's billed. Deliberately scoped to
-- order_lines/orders only -- bills/ledger_entries/payment_allocations stay
-- exactly as immutable as 0008_billing.sql built them ("No update/delete
-- anywhere -- immutable audit trail"). The app enforces "unbilled only" by
-- checking for a bills row before deleting (src/app/actions/manage-orders.ts);
-- these policies are the RLS-level backstop for that same rule -- admin only,
-- same is_admin() pattern as every other admin-mutable table.

create policy "order_lines_delete_admin"
  on public.order_lines for delete
  using (public.is_admin());

create policy "orders_delete_admin"
  on public.orders for delete
  using (public.is_admin());
