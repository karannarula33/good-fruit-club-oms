-- Billed quantity, separate from the packed quantity (admin, 2026-10-17).
--
-- order_lines.actual_qty stays what was physically packed (weight or count)
-- and is what COGS uses. order_lines.billed_qty is what the customer is billed
-- for; null means "same as packed", so existing lines and untouched lines
-- bill exactly as before. The billing person (admin, or a packer with billing
-- access) sets it before generating the bill; only the admin can change the
-- packed quantity.
--
-- quantity_overrides gains `field` so a billed-qty correction is audited
-- separately from a packed-qty correction.

alter table public.order_lines
  add column if not exists billed_qty numeric(8, 3) check (billed_qty is null or billed_qty >= 0);

comment on column public.order_lines.billed_qty is
  'Quantity billed to the customer; null = same as actual_qty (packed). COGS always uses actual_qty.';

alter table public.quantity_overrides
  add column if not exists field text not null default 'actual' check (field in ('actual', 'billed'));
