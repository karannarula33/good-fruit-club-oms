-- Slice 1: profiles + roles + RLS.
-- Role is assigned by an admin after a person's first phone OTP login (small,
-- known internal team - no self-serve role selection). Role starts null and
-- is set directly by an admin (SQL/dashboard for now; an admin screen can
-- come later), which is why the check constraint allows null.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  role text check (role in ('admin', 'packer', 'delivery')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- security definer helper so policies below don't recurse through RLS
-- on public.profiles when checking the caller's own role.
create function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles for select
  using (public.is_admin());

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role is not distinct from (select role from public.profiles where id = auth.uid()));

create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

-- auto-create a profile row (role null) the first time someone completes
-- phone OTP signup, so there's always a row for an admin to assign a role to.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.phone, null);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
