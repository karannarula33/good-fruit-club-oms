-- Order channel (admin 2026-10-27): where the customer placed the order, for
-- reporting website vs WhatsApp separately (orders, revenue, retention...).
--
--   'website'  -- placed on goodfruit.club (ingested by /api/website/orders,
--                 or pasted with its site order number "GFC-1234").
--   'whatsapp' -- everything else: 1:1 WhatsApp chats and WhatsApp group
--                 orders alike (admin decision: groups are not a separate
--                 channel).
--
-- Separate from orders.source on purpose: `source` says how the row was
-- created and changes billing (site prices are kept for source='website'),
-- while `channel` is reporting only and an admin may correct it by hand.
--
-- Set automatically by a trigger:
--   * on insert: website when source = 'website' or the paste carries a
--     GFC-#### site order number; otherwise the column default, whatsapp.
--   * when a paste merges into an existing order and brings the first GFC
--     number, the order becomes website.
-- A manual change (Manage Orders) is never overwritten unless the paste text
-- itself changes as above.

alter table public.orders
  add column if not exists channel text not null default 'whatsapp'
    check (channel in ('website', 'whatsapp'));

create index if not exists orders_channel_idx on public.orders (channel);

create or replace function public.set_order_channel()
returns trigger
language plpgsql
as $$
declare
  site_ref constant text := 'GFC-[0-9]{3,}';
begin
  if tg_op = 'INSERT' then
    -- to_jsonb so this works whether or not orders.source exists yet.
    if coalesce(to_jsonb(new) ->> 'source', '') = 'website'
       or coalesce(new.raw_paste, '') ~ site_ref then
      new.channel := 'website';
    end if;
  elsif new.raw_paste is distinct from old.raw_paste
        and coalesce(new.raw_paste, '') ~ site_ref
        and coalesce(old.raw_paste, '') !~ site_ref then
    new.channel := 'website';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_channel on public.orders;
create trigger orders_set_channel
  before insert or update of raw_paste on public.orders
  for each row execute function public.set_order_channel();

-- Backfill what the database itself can tell: ingested website orders and
-- pastes carrying a site order number. Website orders pasted without their
-- number are matched against the site's order list by
-- scripts/backfill_order_channel.ts.
update public.orders o
set channel = 'website'
where o.channel <> 'website'
  and (coalesce(to_jsonb(o) ->> 'source', '') = 'website'
       or coalesce(o.raw_paste, '') ~ 'GFC-[0-9]{3,}');
