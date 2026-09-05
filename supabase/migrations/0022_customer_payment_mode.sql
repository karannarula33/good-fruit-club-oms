-- Delivery sheet (src/app/api/admin/orders/delivery-sheet/route.ts) shows a
-- COD amount to collect only for customers who pay cash on delivery --
-- customers who settle online after the WhatsApp bill must never have an
-- amount printed for the delivery staff to chase. Nothing in the schema
-- previously recorded this distinction, so it's a plain admin-set flag,
-- defaulting to the common case (online) rather than guessed from ledger
-- history, which could misclassify a customer who occasionally pays cash.

alter table public.customers
  add column payment_mode text not null default 'online' check (payment_mode in ('cod', 'online'));
