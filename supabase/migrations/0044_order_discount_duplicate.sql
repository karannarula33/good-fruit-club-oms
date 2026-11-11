-- Order discounts and duplicate orders (admin, 2026-11-11).
--
-- Discount: the admin can take a flat rupee amount or a percentage off an
-- order on Manage Orders, with a reason. It's stored on the order and applied
-- when the bill is made (or the bill is rebuilt, if it's already billed):
-- bill total = items + gift packing - discount. bills.discount keeps the
-- rupee amount taken off that bill, for the bill text and the dashboard.
-- Rules: src/lib/billing/discount.ts.
--
-- Duplicate: a second, identical order for the same customer on the same
-- delivery date (e.g. a second box), kept separate from the first.
-- duplicated_from points at the order it was copied from.

alter table public.orders
  add column if not exists discount_type text check (discount_type in ('amount', 'percent')),
  add column if not exists discount_value numeric(10,2) check (discount_value is null or discount_value > 0),
  add column if not exists discount_reason text,
  add column if not exists discount_set_by uuid references public.profiles (id),
  add column if not exists discount_set_at timestamptz,
  add column if not exists duplicated_from uuid references public.orders (id) on delete set null;

alter table public.orders drop constraint if exists orders_discount_pair_check;
alter table public.orders
  add constraint orders_discount_pair_check
  check ((discount_type is null) = (discount_value is null));

alter table public.bills
  add column if not exists discount numeric(10,2) not null default 0;
