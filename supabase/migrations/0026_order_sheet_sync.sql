-- Daily order -> Google Sheets sync: dedupe marker. The cron
-- (src/lib/sheet-sync/pipeline.ts) only processes orders with no row here,
-- and inserts one immediately after a successful append to the sheet --
-- append-only, each order synced exactly once, safe to re-run.

create table public.order_sheet_sync (
  order_id  uuid primary key references public.orders (id),
  synced_at timestamptz not null default now()
);

alter table public.order_sheet_sync enable row level security;

create policy "order_sheet_sync_select_any_role"
  on public.order_sheet_sync for select
  using (public.has_role());
create policy "order_sheet_sync_write_admin"
  on public.order_sheet_sync for all
  using (public.is_admin())
  with check (public.is_admin());
