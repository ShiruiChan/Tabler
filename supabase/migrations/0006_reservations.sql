-- =============================================================================
-- 0006_reservations.sql
-- Reservation schema: availability rules, per-tenant reservation settings,
-- and reservations with physical-table double-booking exclusion.
--
-- Design notes
-- ============
-- 1. availability_rules stores a per-tenant weekly schedule (one row per
--    weekday per tenant).  UNIQUE (tenant_id, weekday) enforces the simple
--    single-shift model; split shifts are out of scope.
--
-- 2. reservation_settings is a 1:1 companion to tenants (PK = FK), auto-
--    created by trigger on tenant INSERT and backfilled for existing tenants,
--    matching the pattern used by 0003_site_settings.sql for site_settings.
--
-- 3. reservations carries a denormalized tenant_id (RLS speed) and an optional
--    floor_table_id.  When floor_table_id IS NOT NULL the EXCLUSION constraint
--    `reservations_no_double_book` (btree_gist) prevents overlapping active
--    bookings on the same physical table.  Rows with NULL floor_table_id are
--    "unassigned" bookings; capacity-level checks are TASK-019 application logic.
--
-- 4. Anonymous / guest creation (no auth.uid()) is intentionally NOT exposed
--    through RLS here.  Unauthenticated booking requests must go through the
--    TASK-019 server-side API route which uses the service role to bypass RLS.
--    This keeps PII off the anonymous read path while allowing the API to
--    enforce availability and write on behalf of guests.
--
-- 5. The guard_visitor_reservation_update BEFORE UPDATE trigger restricts
--    visitor (non-tenant-role) callers to status-only mutations and only the
--    pending/confirmed → cancelled transition, matching the guard trigger style
--    from 0001_core_tenancy.sql (guard_tenant_status, guard_profile_escalation).
--    Service-role callers (the TASK-019 server-side API) bypass this guard
--    entirely: they are trusted backend code that has already validated inputs
--    and enforced business rules at the application layer.  The exemption is
--    detected via request.jwt.claims->>'role' = 'service_role' (the same JWT
--    field Supabase populates for service-role requests); auth.role() is
--    deprecated and not used.
--
-- 6. All helper functions follow the 0001–0005 convention: SECURITY DEFINER
--    with search_path = '' and fully-qualified object references.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. btree_gist extension (required for the EXCLUSION constraint on reservations)
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. availability_rules
--    One row per (tenant, weekday) describing the opening window and slot config.
-- ---------------------------------------------------------------------------
create table public.availability_rules (
  id                    uuid        primary key default gen_random_uuid(),
  tenant_id             uuid        not null
                          references public.tenants(id) on delete cascade,

  -- 0 = Sunday … 6 = Saturday  (matches JavaScript Date.getDay())
  weekday               smallint    not null
                          constraint availability_rules_weekday_range
                          check (weekday between 0 and 6),

  opens_at              time        not null,
  closes_at             time        not null,

  constraint availability_rules_window_valid
    check (opens_at < closes_at),

  -- Booking slot granularity in minutes.
  slot_minutes          integer     not null default 30
                          constraint availability_rules_slot_minutes_values
                          check (slot_minutes in (15, 30, 60)),

  -- How many minutes before closing time the last slot may start.
  last_seating_minutes  integer     not null default 90
                          constraint availability_rules_last_seating_range
                          check (last_seating_minutes between 0 and 480),

  -- When true this row marks the day as fully closed; opens_at/closes_at are
  -- stored for UI display but ignored by the availability engine.
  is_closed             boolean     not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Simple model: one rule per weekday per tenant.
  constraint availability_rules_tenant_weekday_unique
    unique (tenant_id, weekday)
);

create trigger availability_rules_set_updated_at
  before update on public.availability_rules
  for each row execute function public.set_updated_at();

-- Drives slot-generation queries: rules for a given tenant, ordered by day.
create index availability_rules_tenant_weekday_idx
  on public.availability_rules (tenant_id, weekday);

-- ---------------------------------------------------------------------------
-- 2. reservation_settings
--    Per-tenant scalar booking configuration (1:1 with tenants, PK = FK).
-- ---------------------------------------------------------------------------
create table public.reservation_settings (
  -- 1:1 with tenants; cascades on tenant delete.
  tenant_id                 uuid    primary key
                              references public.tenants(id) on delete cascade,

  -- Maximum guests allowed in a single booking.
  max_party_size            integer not null default 12
                              constraint reservation_settings_max_party_range
                              check (max_party_size between 1 and 100),

  -- Earliest a booking may be made (minutes from now).
  min_advance_minutes       integer not null default 60
                              constraint reservation_settings_min_advance_nn
                              check (min_advance_minutes >= 0),

  -- Latest a booking may be made (days from today).
  max_advance_days          integer not null default 60
                              constraint reservation_settings_max_advance_nn
                              check (max_advance_days >= 0),

  -- Default booking duration used when computing ends_at.
  default_duration_minutes  integer not null default 90
                              constraint reservation_settings_duration_range
                              check (default_duration_minutes between 15 and 480),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger reservation_settings_set_updated_at
  before update on public.reservation_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Trigger: auto-create a default reservation_settings row on tenant INSERT
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_tenant_reservation_settings()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.reservation_settings (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger on_tenant_created_reservation_settings
  after insert on public.tenants
  for each row execute function public.handle_new_tenant_reservation_settings();

-- ---------------------------------------------------------------------------
-- 4. Backfill: ensure every existing tenant has a reservation_settings row
-- ---------------------------------------------------------------------------
insert into public.reservation_settings (tenant_id)
  select id from public.tenants
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. reservations
-- ---------------------------------------------------------------------------
create table public.reservations (
  id              uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed - enforced to match floor_table's tenant_id
  -- by the check_reservation_table_tenant trigger below.
  tenant_id       uuid        not null
                    references public.tenants(id) on delete cascade,

  -- Optional: pin to a specific physical table.  NULL = unassigned / any table.
  -- SET NULL on floor_table delete preserves the historical booking record.
  floor_table_id  uuid
                    references public.floor_tables(id) on delete set null,

  -- Optional: links the booking to a registered auth user.
  -- NULL = guest booking (created via service-role API in TASK-019).
  user_id         uuid
                    references auth.users(id) on delete set null,

  -- Guest contact details.
  guest_name      text        not null
                    constraint reservations_guest_name_length
                    check (char_length(guest_name) between 1 and 120),

  guest_email     text
                    constraint reservations_guest_email_format
                    check (
                      guest_email is null
                      or (
                        char_length(guest_email) between 3 and 254
                        and position('@' in guest_email) > 1
                      )
                    ),

  guest_phone     text
                    constraint reservations_guest_phone_length
                    check (
                      guest_phone is null
                      or char_length(guest_phone) between 5 and 40
                    ),

  -- Number of guests in the party.
  party_size      integer     not null
                    constraint reservations_party_size_range
                    check (party_size between 1 and 100),

  -- Booking window (stored in UTC).
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,

  constraint reservations_window_valid
    check (starts_at < ends_at),

  -- Lifecycle status.
  status          text        not null default 'pending'
                    constraint reservations_status_values
                    check (status in (
                      'pending', 'confirmed', 'cancelled', 'completed', 'no_show'
                    )),

  -- Optional free-text notes from the guest or staff.
  notes           text
                    constraint reservations_notes_length
                    check (char_length(notes) <= 1000),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- -------------------------------------------------------------------------
  -- Physical-table double-booking exclusion (the core concurrency guard).
  -- Applies only when a specific table is assigned AND the booking is active.
  -- NULL floor_table_id rows are explicitly excluded (no table locked).
  -- btree_gist extension (created above) is required for the tstzrange operator.
  -- -------------------------------------------------------------------------
  constraint reservations_no_double_book
    exclude using gist (
      floor_table_id with =,
      tstzrange(starts_at, ends_at) with &&
    )
    where (
      floor_table_id is not null
      and status in ('pending', 'confirmed')
    )
);

create trigger reservations_set_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

-- Drives the B2B dashboard range query: all reservations for a tenant window.
create index reservations_tenant_starts_idx
  on public.reservations (tenant_id, starts_at);

-- Drives table-availability look-ups: active bookings for a specific table.
create index reservations_table_starts_idx
  on public.reservations (floor_table_id, starts_at)
  where floor_table_id is not null;

-- Drives the "my bookings" visitor query: reservations owned by a user.
create index reservations_user_id_idx
  on public.reservations (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 6. Cross-tenant integrity trigger
--    Ensures that floor_table_id (when provided) belongs to the same tenant
--    as the reservation.  Fires BEFORE INSERT OR UPDATE so the row is never
--    persisted in an invalid state.
-- ---------------------------------------------------------------------------
create or replace function public.check_reservation_table_tenant()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_table_tenant_id uuid;
begin
  -- Nothing to check when no table is assigned.
  if new.floor_table_id is null then
    return new;
  end if;

  select tenant_id
    into v_table_tenant_id
    from public.floor_tables
   where id = new.floor_table_id;

  if v_table_tenant_id is null then
    raise exception 'floor_table % does not exist', new.floor_table_id;
  end if;

  if v_table_tenant_id <> new.tenant_id then
    raise exception
      'floor_table % belongs to tenant % but reservation tenant_id is %',
      new.floor_table_id, v_table_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger reservations_check_table_tenant
  before insert or update on public.reservations
  for each row execute function public.check_reservation_table_tenant();

-- ---------------------------------------------------------------------------
-- 7. Guard trigger: restrict visitor UPDATE to status-only cancellation
--
--    RLS WITH CHECK can enforce what the new status must be, but it cannot
--    compare OLD vs NEW for arbitrary column mutations.  This trigger fills
--    that gap: for any caller that is neither a tenant role nor super_admin it
--    (a) rejects changes to any column other than status, and
--    (b) only allows the transitions pending → cancelled and
--        confirmed → cancelled.
--
--    Mirrors the guard_tenant_status / guard_profile_escalation style from
--    0001_core_tenancy.sql.
-- ---------------------------------------------------------------------------
create or replace function public.guard_visitor_reservation_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- Trusted backend (service role) bypasses the visitor guard entirely.
  -- nullif(..., '') guards against an empty string returned when the GUC is
  -- unset outside of a request context (e.g. pg_cron, direct psql sessions),
  -- which would cause a cast error without the null short-circuit.
  if nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' = 'service_role' then
    return new;
  end if;

  -- Tenant-role callers and super_admin may mutate freely.
  if public.has_tenant_role(old.tenant_id) then
    return new;
  end if;

  -- Immutability: reject changes to any column other than status.
  if new.tenant_id       is distinct from old.tenant_id       or
     new.floor_table_id  is distinct from old.floor_table_id  or
     new.user_id         is distinct from old.user_id         or
     new.guest_name      is distinct from old.guest_name      or
     new.guest_email     is distinct from old.guest_email     or
     new.guest_phone     is distinct from old.guest_phone     or
     new.party_size      is distinct from old.party_size      or
     new.starts_at       is distinct from old.starts_at       or
     new.ends_at         is distinct from old.ends_at         or
     new.notes           is distinct from old.notes
  then
    raise exception
      'permission denied: visitors may only change the status column of a reservation';
  end if;

  -- Only allow pending/confirmed → cancelled.
  if old.status not in ('pending', 'confirmed') then
    raise exception
      'permission denied: reservation in status ''%'' cannot be cancelled', old.status;
  end if;

  if new.status <> 'cancelled' then
    raise exception
      'permission denied: visitors may only cancel reservations (status must be ''cancelled'')';
  end if;

  return new;
end;
$$;

create trigger reservations_guard_visitor_update
  before update on public.reservations
  for each row execute function public.guard_visitor_reservation_update();

-- ---------------------------------------------------------------------------
-- 8. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.availability_rules    enable row level security;
alter table public.reservation_settings  enable row level security;
alter table public.reservations          enable row level security;

-- ---------------------------------------------------------------------------
-- 9. RLS policies - availability_rules
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | tenant active (B2C slot computation)
--   restaurant_owner / staff       | ALL    | own tenant (WITH CHECK)
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: B2C booking flow needs availability rules to compute open slots.
create policy "availability_rules: public read active tenant"
  on public.availability_rules
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tenants
      where id = availability_rules.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of tenant status.
create policy "availability_rules: tenant role read own"
  on public.availability_rules
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "availability_rules: tenant role insert own"
  on public.availability_rules
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "availability_rules: tenant role update own"
  on public.availability_rules
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "availability_rules: tenant role delete own"
  on public.availability_rules
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "availability_rules: super_admin all"
  on public.availability_rules
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 10. RLS policies - reservation_settings
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | tenant active (B2C booking form)
--   restaurant_owner / staff       | SELECT | own tenant, regardless of status
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   super_admin                    | ALL    | unrestricted
--   (no non-super INSERT/DELETE - rows managed by trigger/cascade)
-- ---------------------------------------------------------------------------

-- Public read: B2C booking form needs max_party_size etc. to validate input.
create policy "reservation_settings: public read active tenant"
  on public.reservation_settings
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tenants
      where id = reservation_settings.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: can read their own row regardless of tenant status.
create policy "reservation_settings: tenant role read own"
  on public.reservation_settings
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff update: may tune their own booking configuration.
create policy "reservation_settings: tenant role update own"
  on public.reservation_settings
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "reservation_settings: super_admin all"
  on public.reservation_settings
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 11. RLS policies - reservations
--
-- Policy matrix:
--   anon                           | (none) - PII; unauthenticated creation goes
--                                  |          via service-role API (TASK-019)
--   authenticated visitor          | SELECT | own rows (user_id = auth.uid())
--   authenticated visitor          | INSERT | own rows, tenant active, status='pending'
--   authenticated visitor          | UPDATE | own pending/confirmed → cancelled only
--                                  |         (column immutability enforced by trigger)
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Visitor read: authenticated users may read their own reservations.
create policy "reservations: visitor select own"
  on public.reservations
  for select
  to authenticated
  using (user_id = auth.uid());

-- Visitor insert: authenticated users may create their own pending bookings
-- for active tenants only.
create policy "reservations: visitor insert own"
  on public.reservations
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from public.tenants
      where id = reservations.tenant_id
        and status = 'active'
    )
  );

-- Visitor update: authenticated users may cancel their own pending or confirmed
-- bookings.  Column-level immutability (only status may change) and the exact
-- transition rules (pending/confirmed → cancelled) are enforced by the
-- guard_visitor_reservation_update BEFORE UPDATE trigger above.
create policy "reservations: visitor cancel own"
  on public.reservations
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and status in ('pending', 'confirmed')
  )
  with check (
    user_id = auth.uid()
    and status = 'cancelled'
  );

-- Owner / staff read: all own-tenant rows (dashboard).
create policy "reservations: tenant role read own"
  on public.reservations
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert: create reservations for their tenant (walk-in, phone).
create policy "reservations: tenant role insert own"
  on public.reservations
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update: may modify any reservation for their tenant.
create policy "reservations: tenant role update own"
  on public.reservations
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete: may delete reservations for their tenant.
create policy "reservations: tenant role delete own"
  on public.reservations
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "reservations: super_admin all"
  on public.reservations
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
