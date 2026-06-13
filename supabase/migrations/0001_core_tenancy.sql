-- =============================================================================
-- 0001_core_tenancy.sql
-- Core multi-tenant schema: tenants, profiles, roles, helper functions, RLS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Role enum
-- ---------------------------------------------------------------------------
create type public.user_role as enum (
  'super_admin',
  'restaurant_owner',
  'restaurant_staff',
  'visitor'
);

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger function (reused by all tables)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. tenants table
-- ---------------------------------------------------------------------------
create table public.tenants (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique
                  constraint tenants_slug_format
                  check (
                    slug ~ '^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$'
                    and length(slug) between 3 and 63
                  ),
  name          text        not null,
  custom_domain text        unique,
  status        text        not null default 'active'
                  constraint tenants_status_values
                  check (status in ('active', 'suspended', 'pending')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. profiles table
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid            primary key references auth.users(id) on delete cascade,
  role        public.user_role not null default 'visitor',
  tenant_id   uuid            references public.tenants(id) on delete set null,
  full_name   text,
  created_at  timestamptz     not null default now(),
  updated_at  timestamptz     not null default now(),

  -- tenant_id must be set for tenant-scoped roles, and null for others
  constraint profiles_tenant_id_required
    check (
      (role in ('restaurant_owner', 'restaurant_staff') and tenant_id is not null)
      or
      (role not in ('restaurant_owner', 'restaurant_staff') and tenant_id is null)
    )
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Helper functions (security definer, empty search_path)
-- ---------------------------------------------------------------------------

-- Returns true if the calling user has the super_admin role.
create or replace function public.is_super_admin()
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'super_admin'
  );
$$;

-- Returns the tenant_id of the calling user (null if visitor / super_admin).
create or replace function public.user_tenant_id()
  returns uuid
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select tenant_id
  from public.profiles
  where id = auth.uid();
$$;

-- Returns true if the calling user is a super_admin OR is an owner/staff
-- member of the given tenant t.
create or replace function public.has_tenant_role(t uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and tenant_id = t
        and role in ('restaurant_owner', 'restaurant_staff')
    );
$$;

-- ---------------------------------------------------------------------------
-- 6. Trigger: create profile row when a new auth user is created
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'visitor',
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Trigger: block role / tenant_id escalation unless caller is super_admin
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_escalation()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- super_admin may change anything
  if public.is_super_admin() then
    return new;
  end if;

  -- Prevent any user from changing their own role
  if new.role <> old.role then
    raise exception 'permission denied: cannot change role';
  end if;

  -- Prevent any user from changing their own tenant_id
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'permission denied: cannot change tenant_id';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_escalation
  before update on public.profiles
  for each row execute function public.guard_profile_escalation();

-- ---------------------------------------------------------------------------
-- 7b. Trigger: block tenant status changes unless caller is super_admin
-- ---------------------------------------------------------------------------
create or replace function public.guard_tenant_status()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- super_admin may change status freely
  if public.is_super_admin() then
    return new;
  end if;

  -- All other callers (including restaurant_owner) cannot alter status
  if new.status is distinct from old.status then
    raise exception 'permission denied: cannot change tenant status';
  end if;

  return new;
end;
$$;

create trigger guard_tenant_status_change
  before update on public.tenants
  for each row execute function public.guard_tenant_status();

-- ---------------------------------------------------------------------------
-- 8. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 9. RLS policies - tenants
-- ---------------------------------------------------------------------------

-- Anyone (anon + authenticated) can read active tenants.
create policy "tenants: public read active"
  on public.tenants
  for select
  to anon, authenticated
  using (status = 'active');

-- super_admin has unrestricted access to all rows / all operations.
create policy "tenants: super_admin all"
  on public.tenants
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- restaurant_owner may update their own tenant (not staff).
create policy "tenants: owner update own"
  on public.tenants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'restaurant_owner'
        and tenant_id = tenants.id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'restaurant_owner'
        and tenant_id = tenants.id
    )
  );

-- ---------------------------------------------------------------------------
-- 10. RLS policies - profiles
-- ---------------------------------------------------------------------------

-- Each user can read their own profile row.
create policy "profiles: user select own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Each user can update their own profile row.
-- (role and tenant_id changes are blocked by the guard_profile_escalation trigger.)
create policy "profiles: user update own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- super_admin has unrestricted access to all profile rows.
create policy "profiles: super_admin all"
  on public.profiles
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
