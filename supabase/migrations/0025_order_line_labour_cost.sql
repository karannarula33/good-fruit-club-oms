-- Packer labour cost, allocated per order_line (admin 2026-09-28: include the
-- packer's pay in per-order cost, alongside COGS / packaging / delivery). The
-- monthly wage is spread across each pay-period's sold lines by
-- scripts/apply_packer_labour.ts. Additive + nullable, same landing-spot spirit
-- as actual_packaging_cost / actual_delivery_cost (0023_order_line_costs.sql);
-- RLS already covers order_lines, no policy change needed.
alter table public.order_lines
  add column if not exists actual_labour_cost numeric(10, 2);
