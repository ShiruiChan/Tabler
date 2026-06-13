-- =============================================================================
-- 0002_modules_pricing.sql
-- Platform module catalog, per-tenant feature flags, pricing helpers, RLS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. modules table - platform-wide catalog (super-admin managed)
-- ---------------------------------------------------------------------------
create table public.modules (
  id               text        primary key
                     constraint modules_id_format
                     check (id ~ '^[a-z][a-z0-9_]*$'),
  name             text        not null,
  description      text,
  base_price_cents integer     not null default 0
                     constraint modules_base_price_non_negative
                     check (base_price_cents >= 0),
  billing_period   text        not null default 'monthly'
                     constraint modules_billing_period_values
                     check (billing_period in ('monthly', 'yearly', 'one_time')),
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger modules_set_updated_at
  before update on public.modules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. tenant_modules table - per-tenant feature flags and price overrides
--
-- Column-level access design (see section 6 for implementation):
--   anon + authenticated visitors get only: tenant_id, module_id, enabled,
--   enabled_at via column grants (price_override_cents is excluded).
--   Owners, staff, and super_admin access pricing via the security-definer
--   function public.get_tenant_module_pricing(t uuid) defined in section 5.
-- ---------------------------------------------------------------------------
create table public.tenant_modules (
  tenant_id            uuid        not null
                         references public.tenants(id) on delete cascade,
  module_id            text        not null
                         references public.modules(id) on delete cascade,
  enabled              boolean     not null default false,
  -- null means "use base_price_cents from modules"; non-null overrides it.
  price_override_cents integer
                         constraint tenant_modules_override_non_negative
                         check (price_override_cents is null or price_override_cents >= 0),
  enabled_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  primary key (tenant_id, module_id)
);

create trigger tenant_modules_set_updated_at
  before update on public.tenant_modules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed - reference data for the module catalog
--    Inserted inside the migration so the catalog is always present.
-- ---------------------------------------------------------------------------
insert into public.modules (id, name, description, base_price_cents, billing_period) values
  ('menu',          'Menu Management',
   'Create and manage your digital menu with categories, items, and modifiers.',
   0,    'monthly'),
  ('reservations',  'Reservations',
   'Online table reservations with confirmation emails and calendar view.',
   0,    'monthly'),
  ('site_design',   'Site Design',
   'Customise your restaurant microsite: colours, fonts, hero images, and layout.',
   0,    'monthly'),
  ('events',        'Events',
   'Publish ticketed or free events, sell tickets, and manage RSVPs.',
   2900, 'monthly'),
  ('floor_plan',    'Floor Plan',
   'Interactive floor-plan editor for seating layout and table management.',
   1900, 'monthly'),
  ('delivery',      'Delivery',
   'First-party delivery and take-away ordering with zone and fee configuration.',
   2400, 'monthly'),
  ('ordering',      'Online Ordering',
   'Table-side and QR-code ordering integrated with your menu.',
   1900, 'monthly'),
  ('custom_domain', 'Custom Domain',
   'Serve your restaurant site on your own domain with automatic TLS.',
   900,  'monthly');

-- ---------------------------------------------------------------------------
-- 4. Helper: tenant_has_module
--    Returns true when the tenant has an enabled=true row for that module.
--    Used in application code and future RLS policies.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_has_module(t uuid, m text)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_modules
    where tenant_id = t
      and module_id = m
      and enabled = true
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Security-definer pricing function
--    Only the calling tenant's owner/staff or a super_admin may invoke this.
--    Returns one row per module for the given tenant (enabled or not), with the
--    effective price computed as coalesce(override, base).
--    Raises insufficient_privilege when the caller is unauthorised.
-- ---------------------------------------------------------------------------
create or replace function public.get_tenant_module_pricing(t uuid)
  returns table (
    module_id            text,
    enabled              boolean,
    price_override_cents integer,
    base_price_cents     integer,
    effective_price_cents integer
  )
  language plpgsql
  security definer
  stable
  set search_path = ''
as $$
begin
  -- Authorization: caller must be an owner/staff of this tenant or super_admin.
  if not public.has_tenant_role(t) then
    raise exception 'insufficient_privilege'
      using hint = 'only the tenant owner, staff, or a super_admin may view pricing';
  end if;

  return query
    select
      m.id                                                        as module_id,
      coalesce(tm.enabled, false)                                 as enabled,
      tm.price_override_cents                                     as price_override_cents,
      m.base_price_cents                                          as base_price_cents,
      coalesce(tm.price_override_cents, m.base_price_cents)       as effective_price_cents
    from public.modules m
    left join public.tenant_modules tm
      on tm.module_id = m.id
      and tm.tenant_id = t
    where m.is_active = true
    order by m.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.modules        enable row level security;
alter table public.tenant_modules enable row level security;

-- ---------------------------------------------------------------------------
-- 7. RLS policies - modules
-- ---------------------------------------------------------------------------

-- Anyone can read modules that are active.
create policy "modules: public read active"
  on public.modules
  for select
  to anon, authenticated
  using (is_active = true);

-- super_admin has unrestricted access to all rows and all operations.
create policy "modules: super_admin all"
  on public.modules
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 8. RLS policies - tenant_modules
--
-- Column-level privacy for price_override_cents:
--   We revoke the default table-level SELECT from anon and authenticated, then
--   grant SELECT only on the safe columns.  RLS still applies on top of these
--   column grants - both must pass for a row to be visible.
--
--   Pricing is intentionally excluded from the column grant for anon and
--   authenticated roles.  Owners, staff, and super_admin access pricing only
--   through public.get_tenant_module_pricing() (security definer, see above).
-- ---------------------------------------------------------------------------

-- Revoke the default public SELECT so we can grant per-column.
revoke select on public.tenant_modules from anon, authenticated;

-- Grant non-sensitive columns to anon and authenticated.
-- price_override_cents is intentionally omitted.
grant select (tenant_id, module_id, enabled, enabled_at)
  on public.tenant_modules to anon, authenticated;

-- Public policy: anon + authenticated visitors can see enabled rows only.
-- (Column grants further restrict what columns are readable.)
create policy "tenant_modules: public read enabled"
  on public.tenant_modules
  for select
  to anon, authenticated
  using (enabled = true);

-- Owner / staff policy: can see ALL rows for their own tenant (incl. disabled
-- and created_at / updated_at - via the definer function for pricing).
create policy "tenant_modules: tenant role read own"
  on public.tenant_modules
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin has unrestricted access to all rows and all operations.
create policy "tenant_modules: super_admin all"
  on public.tenant_modules
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- No INSERT / UPDATE / DELETE policies for anon, authenticated, or owners:
-- only super_admin may write to tenant_modules (pricing implications).
