-- Slice 8: auto-allocation of advance credits runs inside generateBill
-- (src/app/actions/bills.ts), which packer also calls -- payment_allocations
-- only had an admin insert policy from 0008_billing.sql. Mirrors the
-- packer insert policies already granted on bills/ledger_entries there.

create policy "payment_allocations_insert_packer"
  on public.payment_allocations for insert
  with check (public.is_packer());
