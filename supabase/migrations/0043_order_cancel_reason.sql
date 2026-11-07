-- Packers can change an order that is still to be packed (admin, 2026-11-07:
-- Kunal and Ravi, from the packing screen): change an item's quantity,
-- remove an item, add an item, or cancel the whole order WITH A REASON.
-- Cancelling is allowed only while the order is 'recorded' (CLAUDE.md §3.5:
-- cancelled until packed). The order stays on record; these say why and who.
-- Hard-deleting orders stays admin-only (Manage Orders).

alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid references public.profiles (id);
