-- =============================================================================
-- 0004_menu.sql
-- Menu schema: categories and dishes with allergens, full RLS, cross-tenant
-- integrity trigger, indexes.
--
-- Design notes
-- ============
-- 1. tenant_id is DENORMALIZED onto dishes (not just on categories) so that
--    RLS policies and indexes on dishes never need to join to menu_categories.
--    A BEFORE INSERT OR UPDATE trigger (check_dish_category_tenant) ensures
--    the category always belongs to the same tenant as the dish, preventing
--    cross-tenant data leakage at the DB layer.
--
-- 2. Public SELECT policies expose only active categories whose owning tenant
--    is active, and only available dishes of active tenants.  Staff / owner
--    policies use has_tenant_role() (covers restaurant_owner, restaurant_staff,
--    and super_admin) to expose all own-tenant rows regardless of
--    is_active / is_available flags.
--
-- 3. Write policies (INSERT / UPDATE / DELETE) are granted to ANY caller that
--    satisfies has_tenant_role(tenant_id), i.e. restaurant_owner + restaurant_staff
--    + super_admin.  Menu editing is a staff-level duty; owners can do it too.
--    WITH CHECK always re-verifies tenant_id to prevent cross-tenant writes.
--
-- 4. All helper functions are SECURITY DEFINER with search_path = '' and
--    fully-qualified object references, matching the 0001–0003 convention.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. menu_categories
-- ---------------------------------------------------------------------------
create table public.menu_categories (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null
                references public.tenants(id) on delete cascade,
  name        text        not null
                constraint menu_categories_name_length
                check (char_length(name) between 1 and 80),
  description text
                constraint menu_categories_description_length
                check (char_length(description) <= 500),
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger menu_categories_set_updated_at
  before update on public.menu_categories
  for each row execute function public.set_updated_at();

-- Drives the public-menu query: categories for a given tenant, in order.
create index menu_categories_tenant_sort_idx
  on public.menu_categories (tenant_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. dishes
-- ---------------------------------------------------------------------------

-- Allowed allergen identifiers.  Must stay in sync with ALLERGENS in
-- src/lib/types/database.ts and the allergens_valid CHECK below.
create table public.dishes (
  id           uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed - enforced to match category's tenant_id
  -- by the check_dish_category_tenant trigger below.
  tenant_id    uuid        not null
                 references public.tenants(id) on delete cascade,

  category_id  uuid        not null
                 references public.menu_categories(id) on delete cascade,

  name         text        not null
                 constraint dishes_name_length
                 check (char_length(name) between 1 and 120),

  description  text
                 constraint dishes_description_length
                 check (char_length(description) <= 1000),

  -- Stored in cents to avoid floating-point rounding issues.
  price_cents  integer     not null
                 constraint dishes_price_non_negative
                 check (price_cents >= 0),

  photo_url    text,

  -- Subset of the 12 recognised allergen codes.
  allergens    text[]      not null default '{}'
                 constraint dishes_allergens_valid
                 check (
                   allergens <@ array[
                     'gluten','dairy','eggs','fish','shellfish',
                     'tree_nuts','peanuts','soy','sesame',
                     'celery','mustard','sulphites'
                   ]::text[]
                 ),

  is_available boolean     not null default true,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger dishes_set_updated_at
  before update on public.dishes
  for each row execute function public.set_updated_at();

-- Drives the public-menu query: dishes for a given tenant / category, in order.
create index dishes_tenant_category_sort_idx
  on public.dishes (tenant_id, category_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Cross-tenant integrity trigger
--    Ensures that a dish's category_id always belongs to the same tenant as
--    the dish itself.  Fires BEFORE INSERT OR UPDATE so the row is never
--    persisted in an invalid state.
-- ---------------------------------------------------------------------------
create or replace function public.check_dish_category_tenant()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_category_tenant_id uuid;
begin
  select tenant_id
    into v_category_tenant_id
    from public.menu_categories
   where id = new.category_id;

  if v_category_tenant_id is null then
    raise exception 'category % does not exist', new.category_id;
  end if;

  if v_category_tenant_id <> new.tenant_id then
    raise exception
      'category % belongs to tenant % but dish tenant_id is %',
      new.category_id, v_category_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger dishes_check_category_tenant
  before insert or update on public.dishes
  for each row execute function public.check_dish_category_tenant();

-- ---------------------------------------------------------------------------
-- 4. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.menu_categories enable row level security;
alter table public.dishes          enable row level security;

-- ---------------------------------------------------------------------------
-- 5. RLS policies - menu_categories
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | is_active=true AND tenant active
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: active categories whose tenant is active.
create policy "menu_categories: public read active"
  on public.menu_categories
  for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.tenants
      where id = menu_categories.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of is_active.
create policy "menu_categories: tenant role read own"
  on public.menu_categories
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert: may create categories for their own tenant.
create policy "menu_categories: tenant role insert own"
  on public.menu_categories
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update: may modify their own tenant's categories.
create policy "menu_categories: tenant role update own"
  on public.menu_categories
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete: may delete their own tenant's categories (cascades dishes).
create policy "menu_categories: tenant role delete own"
  on public.menu_categories
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "menu_categories: super_admin all"
  on public.menu_categories
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. RLS policies - dishes
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | is_available=true AND tenant active
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: available dishes whose tenant is active.
create policy "dishes: public read available"
  on public.dishes
  for select
  to anon, authenticated
  using (
    is_available = true
    and exists (
      select 1
      from public.tenants
      where id = dishes.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of is_available.
create policy "dishes: tenant role read own"
  on public.dishes
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "dishes: tenant role insert own"
  on public.dishes
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "dishes: tenant role update own"
  on public.dishes
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "dishes: tenant role delete own"
  on public.dishes
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "dishes: super_admin all"
  on public.dishes
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
