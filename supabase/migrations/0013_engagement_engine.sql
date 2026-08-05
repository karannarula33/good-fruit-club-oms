-- Customer Engagement Engine (CLAUDE_engagement_engine_FINAL.md). Purely
-- additive: two new columns on existing tables (never altering their
-- meaning for live orders) plus five new eng_-prefixed tables. Nothing here
-- touches customers/orders/order_lines' existing semantics -- is_historical
-- defaults false for every live order, and locked_cogs_per_unit is nullable
-- so it's a no-op for every line until the historical import (or a future
-- live-COGS feature, out of scope here) populates it.

-- §12.4: distinguishes pre-OMS seeded orders from live ones. The engine
-- reads both identically (per §12.4, never filtered out of engine math) --
-- this flag exists purely so financial reporting can exclude pre-OMS data.
alter table public.orders
  add column if not exists is_historical boolean not null default false;

-- §1/§14.1: mirrors locked_price_per_unit's shape exactly (same precision,
-- nullable -- most lines will never have this populated until either the
-- historical import backfills it or a future live-COGS capture feature
-- exists). Enables true-GP ranking later; until then the engine uses
-- revenue as an explicitly-named proxy (§1).
alter table public.order_lines
  add column if not exists locked_cogs_per_unit numeric(10, 2);

-- Recomputed in full each nightly run; one row per customer (§2).
create table public.eng_customer_state (
  customer_id           uuid primary key references public.customers (id),
  computed_at           timestamptz not null,
  order_count           int not null,
  first_order_at        timestamptz,
  last_order_at         timestamptz,
  days_since_last       int,
  expected_gap_days     numeric,
  severity_ratio        numeric,
  revenue               numeric,
  revenue_percentile    numeric,
  is_vip                boolean,
  aov                   numeric,
  favourite_products    text[],
  last_order_products   text[],
  state                 text not null,
  previous_state        text,
  state_changed_at      timestamptz
);

-- One row per candidate nudge, created each run for currently-triggered
-- customers (§2).
create table public.eng_nudge_queue (
  id                 uuid primary key default gen_random_uuid(),
  run_date           date not null,
  customer_id        uuid not null references public.customers (id),
  trigger_type       text not null,
  recommended_action text not null check (recommended_action in ('message', 'call', 'skip_no_phone')),
  priority_score     numeric not null,
  rationale          text not null,
  draft_message      text,
  draft_rationale    text,
  status             text not null default 'pending' check (status in (
    'pending', 'approved', 'edited', 'relayed', 'skipped', 'snoozed', 'expired'
  )),
  final_message      text,
  snooze_until       date,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz,
  relayed_at         timestamptz
);

-- Auto-derived on later runs by re-reading orders. No manual entry (§2/§0.3).
create table public.eng_nudge_outcomes (
  nudge_id              uuid primary key references public.eng_nudge_queue (id),
  relayed_at            timestamptz,
  reordered_within_7d   boolean,
  reordered_within_14d  boolean,
  reorder_order_id      uuid references public.orders (id),
  days_to_reorder       int,
  evaluated_at          timestamptz
);

create table public.eng_suppression (
  customer_id uuid not null references public.customers (id),
  reason      text not null check (reason in ('complaint', 'requested_no_contact', 'two_unanswered')),
  added_at    timestamptz default now(),
  expires_at  timestamptz,
  primary key (customer_id, reason)
);

create table public.eng_config (
  key        text primary key,
  value      numeric not null,
  updated_at timestamptz default now()
);

alter table public.eng_customer_state enable row level security;
alter table public.eng_nudge_queue enable row level security;
alter table public.eng_nudge_outcomes enable row level security;
alter table public.eng_suppression enable row level security;
alter table public.eng_config enable row level security;

-- §2: select for any authenticated role; all writes admin-only. The
-- nightly job itself runs as service role (bypasses RLS entirely), exactly
-- like the LLM parser routes -- these policies are for admin-driven UI
-- actions (relay/edit/skip/snooze a queue row, manual suppression, tuning
-- eng_config) only.
create policy "eng_customer_state_select_any_role"
  on public.eng_customer_state for select
  using (public.has_role());
create policy "eng_customer_state_write_admin"
  on public.eng_customer_state for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "eng_nudge_queue_select_any_role"
  on public.eng_nudge_queue for select
  using (public.has_role());
create policy "eng_nudge_queue_write_admin"
  on public.eng_nudge_queue for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "eng_nudge_outcomes_select_any_role"
  on public.eng_nudge_outcomes for select
  using (public.has_role());
create policy "eng_nudge_outcomes_write_admin"
  on public.eng_nudge_outcomes for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "eng_suppression_select_any_role"
  on public.eng_suppression for select
  using (public.has_role());
create policy "eng_suppression_write_admin"
  on public.eng_suppression for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "eng_config_select_any_role"
  on public.eng_config for select
  using (public.has_role());
create policy "eng_config_write_admin"
  on public.eng_config for all
  using (public.is_admin())
  with check (public.is_admin());

-- §3 constants, derived from 63 days of real data (490 orders, 131
-- customers). All tunable without code changes.
insert into public.eng_config (key, value) values
  ('VIP_PERCENTILE', 0.90),
  ('MEDIAN_REORDER_GAP_DAYS', 6.7),
  ('COHORT_DEFAULT_GAP_DAYS', 14),
  ('SECOND_ORDER_GRACE_DAYS', 9),
  ('THIRD_ORDER_GRACE_DAYS', 9),
  ('DRIFT_SEVERITY_LOW', 1.5),
  ('DRIFT_SEVERITY_MID', 2.0),
  ('DRIFT_SEVERITY_HIGH', 3.5),
  ('LAPSED_ABSOLUTE_DAYS', 30),
  ('VIP_CHECKIN_INTERVAL_DAYS', 10),
  ('FREQUENCY_CAP_DAYS', 10),
  ('UNANSWERED_COOLDOWN_COUNT', 2),
  ('UNANSWERED_COOLDOWN_DAYS', 30),
  ('CALL_ESCALATION_ENABLED', 1)
on conflict (key) do nothing;
