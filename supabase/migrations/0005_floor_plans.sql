-- =============================================================================
-- 0005_floor_plans.sql
-- Floor plan schema: restaurant floor plans with clickable table zones, full
-- RLS, cross-tenant integrity trigger, indexes.
--
-- Design notes
-- ============
-- 1. tenant_id is DENORMALIZED onto floor_tables (not just on floor_plans) so
--    that RLS policies and indexes on floor_tables never need to join to
--    floor_plans.  A BEFORE INSERT OR UPDATE trigger (check_table_plan_tenant)
--    ensures the floor_plan always belongs to the same tenant as the table,
--    preventing cross-tenant data leakage at the DB layer.
--
-- 2. Public SELECT policies expose:
--      floor_plans  — only is_active=true plans whose owning tenant is active.
--      floor_tables — ALL tables of an active plan whose owning tenant is active,
--                     regardless of is_bookable.  Visitors need to render non-
--                     bookable tables as "unavailable" zones; hiding them would
--                     produce gaps in the rendered map.
--    Staff / owner policies use has_tenant_role() (covers restaurant_owner,
--    restaurant_staff, and super_admin) to expose all own-tenant rows regardless
--    of flags.
--
-- 3. Write policies (INSERT / UPDATE / DELETE) are granted to ANY caller that
--    satisfies has_tenant_role(tenant_id).  WITH CHECK always re-verifies
--    tenant_id to prevent cross-tenant writes.
--
-- 4. zone is stored as jsonb with a CHECK constraint enforcing that
--    jsonb_typeof(zone) = 'object' and zone->>'type' is one of 'rect' or
--    'circle'.  Full geometric field validation is done in the application layer
--    (see floor-actions.ts) so the DB constraint is a lightweight last resort.
--
-- 5. All helper functions follow the 0001–0004 convention: SECURITY DEFINER
--    with search_path = '' and fully-qualified object references.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. floor_plans
-- ---------------------------------------------------------------------------
create table public.floor_plans (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null
                references public.tenants(id) on delete cascade,
  name        text        not null
                constraint floor_plans_name_length
                check (char_length(name) between 1 and 80),
  image_url   text,
  -- Logical coordinate space; zone coordinates are expressed in these units.
  width       integer     not null default 1000
                constraint floor_plans_width_range
                check (width between 100 and 10000),
  height      integer     not null default 700
                constraint floor_plans_height_range
                check (height between 100 and 10000),
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger floor_plans_set_updated_at
  before update on public.floor_plans
  for each row execute function public.set_updated_at();

-- Drives the dashboard and public floor-plan queries: plans for a given
-- tenant, in sort order.
create index floor_plans_tenant_sort_idx
  on public.floor_plans (tenant_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. floor_tables
-- ---------------------------------------------------------------------------
create table public.floor_tables (
  id            uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed — enforced to match floor_plan's tenant_id
  -- by the check_table_plan_tenant trigger below.
  tenant_id     uuid        not null
                  references public.tenants(id) on delete cascade,

  floor_plan_id uuid        not null
                  references public.floor_plans(id) on delete cascade,

  label         text        not null
                  constraint floor_tables_label_length
                  check (char_length(label) between 1 and 20),

  capacity      integer     not null
                  constraint floor_tables_capacity_range
                  check (capacity between 1 and 50),

  -- Clickable zone descriptor.
  -- Valid shapes:
  --   {"type":"rect",   "x":<n>, "y":<n>, "w":<n>, "h":<n>}
  --   {"type":"circle", "cx":<n>,"cy":<n>,"r":<n>}
  zone          jsonb       not null
                  constraint floor_tables_zone_valid
                  check (
                    jsonb_typeof(zone) = 'object'
                    and zone->>'type' in ('rect', 'circle')
                  ),

  is_bookable   boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A label must be unique within a given floor plan.
  constraint floor_tables_plan_label_unique unique (floor_plan_id, label)
);

create trigger floor_tables_set_updated_at
  before update on public.floor_tables
  for each row execute function public.set_updated_at();

-- Drives RLS and application queries: tables for a given tenant / plan.
create index floor_tables_tenant_plan_idx
  on public.floor_tables (tenant_id, floor_plan_id);

-- ---------------------------------------------------------------------------
-- 3. Cross-tenant integrity trigger
--    Ensures that a floor_table's floor_plan_id always belongs to the same
--    tenant as the table itself.  Fires BEFORE INSERT OR UPDATE so the row
--    is never persisted in an invalid state.
-- ---------------------------------------------------------------------------
create or replace function public.check_table_plan_tenant()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_plan_tenant_id uuid;
begin
  select tenant_id
    into v_plan_tenant_id
    from public.floor_plans
   where id = new.floor_plan_id;

  if v_plan_tenant_id is null then
    raise exception 'floor_plan % does not exist', new.floor_plan_id;
  end if;

  if v_plan_tenant_id <> new.tenant_id then
    raise exception
      'floor_plan % belongs to tenant % but floor_table tenant_id is %',
      new.floor_plan_id, v_plan_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger floor_tables_check_plan_tenant
  before insert or update on public.floor_tables
  for each row execute function public.check_table_plan_tenant();

-- ---------------------------------------------------------------------------
-- 4. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.floor_plans  enable row level security;
alter table public.floor_tables enable row level security;

-- ---------------------------------------------------------------------------
-- 5. RLS policies — floor_plans
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | is_active=true AND tenant active
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: active floor plans whose tenant is active.
create policy "floor_plans: public read active"
  on public.floor_plans
  for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.tenants
      where id = floor_plans.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of is_active.
create policy "floor_plans: tenant role read own"
  on public.floor_plans
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "floor_plans: tenant role insert own"
  on public.floor_plans
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "floor_plans: tenant role update own"
  on public.floor_plans
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "floor_plans: tenant role delete own"
  on public.floor_plans
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "floor_plans: super_admin all"
  on public.floor_plans
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. RLS policies — floor_tables
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | parent plan is_active=true AND
--                                  |        | tenant active (via floor_plans join);
--                                  |        | is_bookable ignored — all tables shown
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: all tables whose parent floor plan is active and tenant is active.
-- is_bookable is intentionally NOT checked — non-bookable tables must render as
-- "unavailable" zones on the public floor map.
create policy "floor_tables: public read active plan"
  on public.floor_tables
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.floor_plans fp
      join public.tenants t on t.id = fp.tenant_id
      where fp.id = floor_tables.floor_plan_id
        and fp.is_active = true
        and t.status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of is_bookable.
create policy "floor_tables: tenant role read own"
  on public.floor_tables
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "floor_tables: tenant role insert own"
  on public.floor_tables
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "floor_tables: tenant role update own"
  on public.floor_tables
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "floor_tables: tenant role delete own"
  on public.floor_tables
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "floor_tables: super_admin all"
  on public.floor_tables
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
