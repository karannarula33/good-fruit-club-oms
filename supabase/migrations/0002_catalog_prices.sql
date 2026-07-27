-- Slice 2: catalog (products + aliases) and price versions/items.
-- Extends the schema additively per CLAUDE.md §4/§8. RLS mirrors the
-- is_admin() pattern from 0001_profiles.sql.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                         -- canonical, e.g. 'Alphonso Mango'
  unit_type text not null check (unit_type in ('weight', 'count')),
  unit_label text,                                    -- 'kg', 'dozen', 'piece', 'Box'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  alias text not null unique,                         -- trimmed; e.g. 'Hapus' -> Alphonso Mango
  created_at timestamptz not null default now()
);

create table public.price_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null,
  published_by uuid references public.profiles (id),  -- nullable: seed data has no publisher
  note text,
  created_at timestamptz not null default now()
);

create table public.price_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.price_versions (id),
  product_id uuid not null references public.products (id),
  -- belt-and-suspenders on top of the app-level guard in §3.2: a published
  -- price is never silently zero. Additive to §4's literal schema.
  price_per_unit numeric(10, 2) not null check (price_per_unit > 0),
  unique (version_id, product_id)
);

alter table public.products enable row level security;
alter table public.product_aliases enable row level security;
alter table public.price_versions enable row level security;
alter table public.price_items enable row level security;

-- Any authenticated profile with an assigned role can read the catalog
-- (packer will need product names for the packing queue in a later slice).
-- Security-definer, same reasoning as is_admin() in 0001: avoids RLS
-- recursion through profiles when checking the caller's own role.
create function public.has_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role is not null
  );
$$;

create policy "products_select_any_role"
  on public.products for select
  using (public.has_role());

create policy "products_insert_admin"
  on public.products for insert
  with check (public.is_admin());

create policy "products_update_admin"
  on public.products for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "products_delete_admin"
  on public.products for delete
  using (public.is_admin());

create policy "product_aliases_select_any_role"
  on public.product_aliases for select
  using (public.has_role());

create policy "product_aliases_insert_admin"
  on public.product_aliases for insert
  with check (public.is_admin());

create policy "product_aliases_update_admin"
  on public.product_aliases for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "product_aliases_delete_admin"
  on public.product_aliases for delete
  using (public.is_admin());

-- Prices: admin-only SELECT + INSERT, no UPDATE/DELETE at all. Published
-- versions are immutable; corrections happen via a new version.
create policy "price_versions_select_admin"
  on public.price_versions for select
  using (public.is_admin());

create policy "price_versions_insert_admin"
  on public.price_versions for insert
  with check (public.is_admin());

create policy "price_items_select_admin"
  on public.price_items for select
  using (public.is_admin());

create policy "price_items_insert_admin"
  on public.price_items for insert
  with check (public.is_admin());

-- Publishes a price version + its items + any newly-learned aliases in one
-- transaction, so a partial failure (e.g. one line still unmapped) never
-- leaves an empty/half-published version. security invoker (default): runs
-- as the calling role, so the RLS policies above still apply to every
-- insert inside the function body; the explicit is_admin() check just gives
-- a clearer error than a bare RLS-violation would.
create function public.publish_price_version(
  p_effective_from timestamptz,
  p_note text,
  p_items jsonb,        -- [{ "product_id": uuid, "price_per_unit": numeric }, ...]
  p_new_aliases jsonb    -- [{ "product_id": uuid, "alias": text }, ...]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no priced items to publish';
  end if;

  insert into public.price_versions (effective_from, published_by, note)
  values (p_effective_from, auth.uid(), p_note)
  returning id into v_version_id;

  -- a null product_id (unmapped line slipping through) violates the
  -- not-null constraint on price_items.product_id and rolls back the
  -- whole function body -- this is the server-side half of the guard.
  insert into public.price_items (version_id, product_id, price_per_unit)
  select v_version_id, (item ->> 'product_id')::uuid, (item ->> 'price_per_unit')::numeric
  from jsonb_array_elements(p_items) as item;

  insert into public.product_aliases (product_id, alias)
  select (a ->> 'product_id')::uuid, trim(a ->> 'alias')
  from jsonb_array_elements(coalesce(p_new_aliases, '[]'::jsonb)) as a
  on conflict (alias) do nothing;

  return v_version_id;
end;
$$;

grant execute on function public.publish_price_version(timestamptz, text, jsonb, jsonb) to authenticated;
