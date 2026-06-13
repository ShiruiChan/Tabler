-- =============================================================================
-- 0008_delivery.sql
-- Delivery schema: per-tenant delivery settings (singleton) and per-tenant
-- delivery zones with optional geo-polygon and fee overrides.
--
-- Design notes
-- ============
-- 1. delivery_settings is a 1:1 companion to tenants (UUID PK = FK), auto-
--    created by trigger on tenant INSERT and backfilled for existing tenants,
--    matching the pattern used by 0003_site_settings.sql (site_settings) and
--    0006_reservations.sql (reservation_settings).
--
-- 2. delivery_zones has multiple rows per tenant (unlike delivery_settings).
--    UNIQUE (tenant_id, name) gives a predictable constraint name
--    (delivery_zones_tenant_id_name_key) that TASK-028 API code can map to a
--    user-friendly 23505 duplicate-name error.
--
-- 3. schedule (on delivery_settings) is a jsonb column describing per-weekday
--    delivery hours.  All times are UTC.  The canonical shape is:
--
--      {
--        "0": { "open": "10:00", "close": "22:00", "closed": false },
--        "1": { "open": "10:00", "close": "22:00", "closed": false },
--        ...
--        "6": { "open": "10:00", "close": "21:00", "closed": false }
--      }
--
--    Keys "0"–"6" map to Sunday–Saturday (JS Date.getDay() convention, matching
--    0006 availability_rules).  A day with "closed": true is treated as not
--    accepting delivery orders regardless of the open/close values.  The default
--    value {} means "no delivery hours configured"; the application layer MUST
--    treat missing keys as closed days (see TASK-028 logic).  Full semantic
--    validation of the per-day objects is intentionally deferred to the
--    application layer to keep the DB constraint lightweight and avoid brittle
--    schema coupling (same rationale as 0005 zone, 0003 social).
--
-- 4. polygon (on delivery_zones) is a jsonb column containing an array of
--    [longitude, latitude] coordinate pairs describing the delivery zone boundary.
--    The canonical shape is:
--
--      [ [lng0, lat0], [lng1, lat1], ..., [lngN, latN] ]
--
--    A DB BEFORE INSERT OR UPDATE trigger (validate_delivery_zone_polygon)
--    enforces structural integrity when polygon IS NOT NULL:
--      - must be a JSON array;
--      - must contain at least 3 points (a valid polygon);
--      - each element must be a 2-element array of numbers (finite, not NaN).
--    This mirrors the bounds-validation rigor added to 0005 floor_plans after
--    TASK-015 rejection.  Full geographic validation (self-intersection, etc.)
--    is deferred to the application layer (TASK-028).
--
-- 5. Public SELECT visibility for delivery_settings:
--    Readable by anon/visitor whenever the tenant is active, regardless of
--    is_enabled.  Rationale: the B2C ordering flow needs to display a "delivery
--    unavailable" state when is_enabled=false without requiring authentication;
--    hiding the row entirely would force the client to distinguish "no row" from
--    "row with is_enabled=false", which adds unnecessary complexity.
--
-- 6. Public SELECT visibility for delivery_zones:
--    Readable by anon/visitor only when is_active=true AND the tenant is active.
--    Inactive zones are hidden from the B2C map to avoid showing disabled zones.
--
-- 7. No guard trigger is needed for these tables beyond standard RLS.  Delivery
--    settings have no sensitive visitor-writable path (visitors never write to
--    either table).  Service-role bypass is not required here; if a future order
--    API (TASK-027/028) needs to read these tables as service-role, table-level
--    RLS bypasses automatically for service_role in Supabase.
--
-- 8. TASK-027 (orders / order_items) considerations:
--    - orders should carry a delivery_zone_id uuid NULL REFERENCES
--      public.delivery_zones(id) ON DELETE SET NULL to link an order to the
--      zone it was placed in.  SET NULL is correct because zone deletion must
--      not destroy order history.
--    - orders should also carry a fee_cents int and snapshot delivery fee at
--      order creation time from either the zone's fee_override_cents or the
--      tenant's base_fee_cents (application layer resolves this).
--    - No FK from delivery_zones back to delivery_settings is needed - both
--      reference tenants(id) directly; application logic joins them by tenant_id.
--
-- 9. 'delivery' module was already seeded in 0002_modules_pricing.sql.
--    No additional seeding is required here.
--
-- 10. All helper functions follow the 0001–0007 convention: SECURITY DEFINER
--     with search_path = '' and fully-qualified object references.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. delivery_settings (1:1 per tenant)
-- ---------------------------------------------------------------------------
create table public.delivery_settings (
  -- 1:1 with tenants; cascades on tenant delete.
  -- Using a standalone uuid PK (not PK=FK) to allow direct uuid lookups without
  -- knowing tenant_id, consistent with other settings tables that grew FKs
  -- after initial design. tenant_id carries the UNIQUE NOT NULL FK.
  id                       uuid        primary key default gen_random_uuid(),

  tenant_id                uuid        not null unique
                             references public.tenants(id) on delete cascade,

  -- Master switch: delivery orders are only accepted when true.
  is_enabled               boolean     not null default false,

  -- Minimum basket value (in cents) for a delivery order to be accepted.
  -- 0 = no minimum.  Upper bound 10,000,000 (~$100,000) guards against data errors.
  min_order_cents          integer     not null default 0
                             constraint delivery_settings_min_order_range
                             check (min_order_cents between 0 and 10000000),

  -- Flat delivery fee (in cents) charged when no zone fee_override_cents applies.
  -- 0 = free delivery by default.
  base_fee_cents           integer     not null default 0
                             constraint delivery_settings_base_fee_range
                             check (base_fee_cents between 0 and 1000000),

  -- When non-null, orders whose subtotal meets or exceeds this amount qualify
  -- for free delivery (overrides base_fee_cents; zone overrides still apply).
  -- 0 is allowed (free delivery always) when explicitly set.
  free_delivery_over_cents integer
                             constraint delivery_settings_free_delivery_range
                             check (
                               free_delivery_over_cents is null
                               or free_delivery_over_cents between 0 and 10000000
                             ),

  -- ISO 4217 currency code.  Must match the allowlist used by events / event_tickets
  -- in 0007_events.sql so Stripe (TASK-030) sees a consistent currency across features.
  currency                 text        not null default 'usd'
                             constraint delivery_settings_currency_values
                             check (currency in ('usd', 'eur', 'gbp', 'rub')),

  -- Per-weekday delivery window configuration.
  -- Shape: {"0": {"open":"HH:MM","close":"HH:MM","closed":bool}, ... "6": {...}}
  -- Keys 0–6 correspond to Sunday–Saturday (JS Date.getDay() convention).
  -- All times are UTC.  Missing keys are treated as closed days by the application.
  -- {} (empty object) is the canonical "not yet configured" sentinel.
  schedule                 jsonb       not null default '{}'::jsonb
                             constraint delivery_settings_schedule_object
                             check (jsonb_typeof(schedule) = 'object'),

  -- Estimated delivery time in minutes shown to customers at checkout.
  -- null = not displayed.  Range 5–480 when non-null (avoids absurd values).
  estimated_minutes        integer
                             constraint delivery_settings_estimated_minutes_range
                             check (
                               estimated_minutes is null
                               or estimated_minutes between 5 and 480
                             ),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger delivery_settings_set_updated_at
  before update on public.delivery_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Trigger: auto-create a default delivery_settings row on tenant INSERT
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_tenant_delivery_settings()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.delivery_settings (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger on_tenant_created_delivery_settings
  after insert on public.tenants
  for each row execute function public.handle_new_tenant_delivery_settings();

-- ---------------------------------------------------------------------------
-- 3. Backfill: ensure every existing tenant has a delivery_settings row
-- ---------------------------------------------------------------------------
insert into public.delivery_settings (tenant_id)
  select id from public.tenants
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. delivery_zones (multiple per tenant)
-- ---------------------------------------------------------------------------
create table public.delivery_zones (
  id                       uuid        primary key default gen_random_uuid(),

  tenant_id                uuid        not null
                             references public.tenants(id) on delete cascade,

  -- Human-readable zone name (e.g. "City Centre", "Suburbs").
  -- 1–80 characters; UNIQUE (tenant_id, name) prevents duplicate map zones
  -- and gives a predictable 23505 constraint name for API error mapping:
  -- delivery_zones_tenant_id_name_key
  name                     text        not null
                             constraint delivery_zones_name_length
                             check (char_length(name) between 1 and 80),

  -- GeoJSON-style polygon expressed as an array of [longitude, latitude] pairs.
  -- Shape: [[lng0,lat0],[lng1,lat1],...,[lngN,latN]]
  -- null = zone has no map boundary (e.g. a named area without a drawn polygon).
  -- Structural validation (array, ≥3 points, each a 2-number array) is enforced
  -- by the validate_delivery_zone_polygon trigger below.
  -- Full geographic validation (projection validity, self-intersection, closure)
  -- is the responsibility of the TASK-028 application layer.
  polygon                  jsonb,

  -- Per-zone delivery fee override in cents.
  -- null = use delivery_settings.base_fee_cents for this zone.
  -- 0 = free delivery for this zone regardless of base fee.
  fee_override_cents       integer
                             constraint delivery_zones_fee_override_range
                             check (
                               fee_override_cents is null
                               or fee_override_cents between 0 and 1000000
                             ),

  -- Per-zone minimum order override in cents.
  -- null = use delivery_settings.min_order_cents for this zone.
  min_order_override_cents integer
                             constraint delivery_zones_min_order_override_range
                             check (
                               min_order_override_cents is null
                               or min_order_override_cents between 0 and 10000000
                             ),

  -- When false the zone is suspended (e.g. staffing shortage) without deletion.
  -- Inactive zones are hidden from the public B2C map (see RLS below).
  is_active                boolean     not null default true,

  -- Display order when listing zones in the admin dashboard (ascending).
  sort_order               integer     not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Predictable constraint name used for 23505 error mapping in TASK-028:
  -- "delivery_zones_tenant_id_name_key"
  constraint delivery_zones_tenant_id_name_key
    unique (tenant_id, name)
);

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- Drives the admin dashboard list: all zones for a tenant in sort order.
create index delivery_zones_tenant_sort_idx
  on public.delivery_zones (tenant_id, sort_order);

-- Drives the public B2C map query: only active zones for an active tenant.
create index delivery_zones_tenant_active_idx
  on public.delivery_zones (tenant_id)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- 5. Polygon validation trigger
--    Enforces structural integrity of the polygon column when non-null.
--    Mirrors the bounds-validation rigor added to 0005 floor_plans.
--
--    Rules (applied only when NEW.polygon IS NOT NULL):
--      (a) polygon must be a JSON array;
--      (b) must contain at least 3 coordinate pairs (minimum valid polygon);
--      (c) each element must be a 2-element array;
--      (d) both elements of each pair must be JSON numbers.
-- ---------------------------------------------------------------------------
create or replace function public.validate_delivery_zone_polygon()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_len   integer;
  v_point jsonb;
  v_i     integer;
begin
  -- Nothing to check when polygon is null.
  if new.polygon is null then
    return new;
  end if;

  -- (a) Must be a JSON array.
  if jsonb_typeof(new.polygon) <> 'array' then
    raise exception
      'delivery_zone polygon must be a JSON array of [lng,lat] pairs, got %',
      jsonb_typeof(new.polygon);
  end if;

  -- (b) Must have at least 3 points.
  v_len := jsonb_array_length(new.polygon);
  if v_len < 3 then
    raise exception
      'delivery_zone polygon must have at least 3 coordinate pairs, got %',
      v_len;
  end if;

  -- (c) + (d) Each element must be a 2-element array of numbers.
  for v_i in 0 .. v_len - 1 loop
    v_point := new.polygon -> v_i;

    if jsonb_typeof(v_point) <> 'array' then
      raise exception
        'delivery_zone polygon point % must be a [lng,lat] array, got %',
        v_i, jsonb_typeof(v_point);
    end if;

    if jsonb_array_length(v_point) <> 2 then
      raise exception
        'delivery_zone polygon point % must have exactly 2 elements, got %',
        v_i, jsonb_array_length(v_point);
    end if;

    if jsonb_typeof(v_point -> 0) <> 'number' then
      raise exception
        'delivery_zone polygon point %: longitude (index 0) must be a number, got %',
        v_i, jsonb_typeof(v_point -> 0);
    end if;

    if jsonb_typeof(v_point -> 1) <> 'number' then
      raise exception
        'delivery_zone polygon point %: latitude (index 1) must be a number, got %',
        v_i, jsonb_typeof(v_point -> 1);
    end if;
  end loop;

  return new;
end;
$$;

create trigger delivery_zones_validate_polygon
  before insert or update on public.delivery_zones
  for each row execute function public.validate_delivery_zone_polygon();

-- ---------------------------------------------------------------------------
-- 6. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.delivery_settings enable row level security;
alter table public.delivery_zones     enable row level security;

-- ---------------------------------------------------------------------------
-- 7. RLS policies - delivery_settings
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | tenant active
--                                  |        | (readable even when is_enabled=false
--                                  |        |  so the UI can show "delivery
--                                  |        |  unavailable" without auth - see note 5)
--   restaurant_owner / staff       | SELECT | own tenant (regardless of status)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   super_admin                    | ALL    | unrestricted
--   (no non-super INSERT/DELETE - rows managed by trigger/cascade)
-- ---------------------------------------------------------------------------

-- Public read: B2C ordering flow reads delivery settings for any active tenant.
-- The row is always visible (not gated on is_enabled) so the front-end can
-- display a "delivery not available" message without needing an authenticated
-- session.  See design note 5.
create policy "delivery_settings: public read active tenant"
  on public.delivery_settings
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tenants
      where id = delivery_settings.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: can read their own row regardless of tenant status.
create policy "delivery_settings: tenant role read own"
  on public.delivery_settings
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff update: may configure delivery settings for their tenant.
create policy "delivery_settings: tenant role update own"
  on public.delivery_settings
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "delivery_settings: super_admin all"
  on public.delivery_settings
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 8. RLS policies - delivery_zones
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | is_active=true AND tenant active
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: only active zones for active tenants (B2C delivery map).
-- Inactive zones are hidden to avoid showing suspended/deleted areas.
create policy "delivery_zones: public read active tenant"
  on public.delivery_zones
  for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.tenants
      where id = delivery_zones.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant zones regardless of is_active.
create policy "delivery_zones: tenant role read own"
  on public.delivery_zones
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "delivery_zones: tenant role insert own"
  on public.delivery_zones
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "delivery_zones: tenant role update own"
  on public.delivery_zones
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "delivery_zones: tenant role delete own"
  on public.delivery_zones
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "delivery_zones: super_admin all"
  on public.delivery_zones
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 9. Column-level comments
--    Postgres COMMENT ON COLUMN gives the schema self-documenting properties
--    visible in psql \d+ and Supabase Studio.
-- ---------------------------------------------------------------------------
comment on table  public.delivery_settings is
  'Per-tenant delivery configuration (singleton - one row per tenant).  Auto-created by trigger on tenant INSERT.';
comment on column public.delivery_settings.schedule is
  'Per-weekday delivery hours in UTC.  Shape: {"0":{"open":"HH:MM","close":"HH:MM","closed":bool},...,"6":{...}}.  Keys 0–6 = Sun–Sat.  Missing keys treated as closed by application.';

comment on table  public.delivery_zones is
  'Named delivery zones for a tenant, each optionally bounded by a geo-polygon and with optional fee/minimum-order overrides.';
comment on column public.delivery_zones.polygon is
  'GeoJSON-style delivery boundary.  Shape: [[lng0,lat0],[lng1,lat1],...].  Null = named zone without a map boundary.  Structural validation (array, ≥3 points, 2-number pairs) enforced by trigger.';
