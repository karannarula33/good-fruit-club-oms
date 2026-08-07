-- CLAUDE_engagement_engine_FINAL.md §9/§14.5, build order §13 slice 4: the
-- draft agent needs a "seasonal_note" input ("cherry season ending, gift
-- boxes launched") that isn't derivable from any existing table -- §14.5
-- calls for "a small admin-set field". eng_config (§3) is numeric-only, so
-- this is a dedicated one-row settings table rather than overloading that
-- table's shape. (todays_catalogue_highlights, the other §14.5 input, is
-- derived from existing price_versions/price_items data -- no schema
-- change needed for that one.)

create table public.eng_settings (
  id           int primary key default 1 check (id = 1),
  seasonal_note text,
  updated_at   timestamptz default now(),
  updated_by   uuid references public.profiles (id)
);

insert into public.eng_settings (id, seasonal_note) values (1, null)
on conflict (id) do nothing;

alter table public.eng_settings enable row level security;

-- Same split as every other eng_* table (0013_engagement_engine.sql):
-- select for any authenticated role, writes admin-only.
create policy "eng_settings_select_any_role"
  on public.eng_settings for select
  using (public.has_role());
create policy "eng_settings_write_admin"
  on public.eng_settings for all
  using (public.is_admin())
  with check (public.is_admin());
