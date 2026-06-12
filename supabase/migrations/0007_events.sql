-- =============================================================================
-- 0007_events.sql
-- Events schema: ticketed/free events per tenant with capacity enforcement,
-- price snapshotting, and per-visitor ticket management.
--
-- Design notes
-- ============
-- 1. tenant_id is DENORMALIZED onto event_tickets (not just on events) so that
--    RLS policies and indexes on event_tickets never need to join to events.
--    A BEFORE INSERT OR UPDATE trigger (check_event_ticket_event_tenant) ensures
--    the referenced event always belongs to the same tenant as the ticket row,
--    preventing cross-tenant data leakage at the DB layer.
--
-- 2. Capacity enforcement (concurrency-safe):
--    The check_event_capacity trigger runs BEFORE INSERT OR UPDATE on
--    event_tickets.  When NEW.status IN ('reserved','paid') it:
--      a) acquires a row-level lock on the parent events row via
--         SELECT … FOR UPDATE — this serializes concurrent inserts/updates for
--         the same event so two simultaneous buyers cannot jointly oversell;
--      b) sums quantity of all OTHER active (reserved+paid) tickets for the
--         event and raises if that sum + NEW.quantity > events.capacity.
--    The lock is held until the transaction commits or rolls back, ensuring
--    snapshot isolation cannot produce phantom oversells.
--
-- 3. unit_price_cents and currency on event_tickets are snapshots of the event's
--    price_cents / currency at purchase time.  The events columns may be updated
--    by restaurant staff later without retroactively changing prior purchase
--    amounts.  Integrity of the snapshot values for visitor INSERTs is enforced
--    in the TASK-023 API layer (not in RLS — RLS cannot read events.price_cents
--    at INSERT time without a subquery that risks TOCTOU drift).
--
-- 4. Anonymous / guest creation is NOT exposed through RLS.  Unauthenticated
--    purchases must go through the TASK-023 server-side API route which uses
--    the service role to bypass RLS — matching the pattern in 0006_reservations.sql.
--
-- 5. The guard_visitor_ticket_update BEFORE UPDATE trigger restricts visitor
--    (non-tenant-role) callers to a single allowed mutation: status column only,
--    and only the 'reserved' → 'cancelled' transition.  Paid tickets may only be
--    cancelled via staff or the Stripe refund webhook (TASK-030).
--    Service-role callers bypass this guard via the same JWT-claims mechanism as
--    0006_reservations.sql: nullif(current_setting('request.jwt.claims', true),
--    '')::jsonb->>'role' = 'service_role'.
--
-- 6. Trigger alphabetical firing order on event_tickets (BEFORE triggers fire
--    alphabetically by trigger name):
--      event_tickets_check_capacity       — fires 1st (INSERT OR UPDATE)
--      event_tickets_check_event_tenant   — fires 2nd (INSERT OR UPDATE)
--      event_tickets_guard_visitor_update — fires 3rd (UPDATE only)
--    The cross-tenant check and capacity check are order-independent for
--    correctness: both reject invalid rows regardless of which fires first.
--    The capacity trigger also raises when the event row does not exist, covering
--    the "no such event" case even when it fires before the cross-tenant check.
--
-- 7. All helper functions follow the 0001–0006 convention: SECURITY DEFINER
--    with search_path = '' and fully-qualified object references.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. events
-- ---------------------------------------------------------------------------
create table public.events (
  id            uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed — event_tickets also carry tenant_id and the
  -- check_event_ticket_event_tenant trigger keeps them consistent.
  tenant_id     uuid        not null
                  references public.tenants(id) on delete cascade,

  title         text        not null
                  constraint events_title_length
                  check (char_length(title) between 1 and 160),

  description   text
                  constraint events_description_length
                  check (description is null or char_length(description) <= 4000),

  image_url     text,

  -- Booking window.
  starts_at     timestamptz not null,
  ends_at       timestamptz
                  constraint events_window_valid
                  check (ends_at is null or starts_at < ends_at),

  -- Total seats available for this event (1–10 000).
  capacity      integer     not null
                  constraint events_capacity_range
                  check (capacity between 1 and 10000),

  -- Ticket face value in cents (0 = free event).
  price_cents   integer     not null default 0
                  constraint events_price_cents_range
                  check (price_cents between 0 and 10000000),

  -- ISO 4217 currency code.  Small allowlist; Stripe (TASK-030) consumes this.
  currency      text        not null default 'usd'
                  constraint events_currency_values
                  check (currency in ('usd', 'eur', 'gbp', 'rub')),

  -- When false the event is hidden from the public listing (draft mode).
  is_published  boolean     not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Drives B2B dashboard and slot-generation queries: events for a tenant
-- ordered by start time.
create index events_tenant_starts_idx
  on public.events (tenant_id, starts_at);

-- Drives the public B2C listing hot path: only published events for a tenant,
-- ordered chronologically.  Partial index is smaller and faster than filtering
-- the full events_tenant_starts_idx on the hot path.
create index events_tenant_starts_published_idx
  on public.events (tenant_id, starts_at)
  where is_published = true;

-- ---------------------------------------------------------------------------
-- 2. event_tickets
--    One row per purchase batch.  A single checkout of N seats is ONE row with
--    quantity=N; this simplifies capacity math and maps cleanly to a Stripe
--    line item (TASK-030).
-- ---------------------------------------------------------------------------
create table public.event_tickets (
  id              uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed — enforced to match event's tenant_id by the
  -- check_event_ticket_event_tenant trigger below.
  tenant_id       uuid        not null
                    references public.tenants(id) on delete cascade,

  event_id        uuid        not null
                    references public.events(id) on delete cascade,

  -- Optional: links the ticket purchase to a registered auth user.
  -- NULL = guest purchase (created via service-role API in TASK-023).
  -- SET NULL when the user account is deleted.
  user_id         uuid
                    references auth.users(id) on delete set null,

  -- Buyer contact details (snapshot at purchase time).
  buyer_name      text        not null
                    constraint event_tickets_buyer_name_length
                    check (char_length(buyer_name) between 1 and 120),

  buyer_email     text
                    constraint event_tickets_buyer_email_format
                    check (
                      buyer_email is null
                      or (
                        char_length(buyer_email) between 3 and 254
                        and position('@' in buyer_email) > 1
                      )
                    ),

  buyer_phone     text
                    constraint event_tickets_buyer_phone_length
                    check (
                      buyer_phone is null
                      or char_length(buyer_phone) between 5 and 40
                    ),

  -- Number of seats in this purchase batch (1–100).
  quantity        integer     not null
                    constraint event_tickets_quantity_range
                    check (quantity between 1 and 100),

  -- Snapshot of events.price_cents at purchase time.  The event price may
  -- change later; this column preserves the amount actually charged.
  -- Integrity for visitor INSERTs is enforced in the TASK-023 API layer.
  unit_price_cents integer    not null
                    constraint event_tickets_unit_price_nn
                    check (unit_price_cents >= 0),

  -- Snapshot of events.currency at purchase time (same allowlist).
  currency        text        not null
                    constraint event_tickets_currency_values
                    check (currency in ('usd', 'eur', 'gbp', 'rub')),

  -- Lifecycle status.
  -- 'reserved' = held pending payment (capacity-checked by DB trigger).
  -- 'paid'     = payment confirmed (Stripe webhook, TASK-030).
  -- 'cancelled'= buyer or staff cancelled.
  -- 'refunded' = payment reversed via Stripe (TASK-030).
  status          text        not null default 'reserved'
                    constraint event_tickets_status_values
                    check (status in ('reserved', 'paid', 'cancelled', 'refunded')),

  -- Stripe payment / charge identifier; null until payment is initiated.
  payment_ref     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger event_tickets_set_updated_at
  before update on public.event_tickets
  for each row execute function public.set_updated_at();

-- Drives capacity-sum queries: active (reserved + paid) tickets for an event.
-- Partial index keeps it narrow — cancelled/refunded rows are excluded.
create index event_tickets_event_active_idx
  on public.event_tickets (event_id)
  where status in ('reserved', 'paid');

-- Drives B2B dashboard query: all tickets for a tenant ordered by purchase time.
create index event_tickets_tenant_created_idx
  on public.event_tickets (tenant_id, created_at);

-- Drives "my tickets" visitor query: tickets owned by a user.
create index event_tickets_user_id_idx
  on public.event_tickets (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Capacity-enforcement trigger
--    Acquires a row-level lock on the parent events row FIRST (FOR UPDATE) so
--    that concurrent inserts for the same event serialize and cannot jointly
--    oversell.  See design note 2 for the concurrency rationale.
-- ---------------------------------------------------------------------------
create or replace function public.check_event_capacity()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_capacity   integer;
  v_active_qty bigint;
begin
  -- Skip capacity check for statuses that do not consume capacity.
  if new.status not in ('reserved', 'paid') then
    return new;
  end if;

  -- Lock the parent event row to serialize concurrent ticket inserts/updates
  -- for this event.  Also validates the event exists.
  select capacity
    into v_capacity
    from public.events
   where id = new.event_id
     for update;

  if v_capacity is null then
    raise exception 'event % does not exist', new.event_id;
  end if;

  -- Sum quantity of OTHER active tickets for this event (exclude current row
  -- on UPDATE so we don't double-count the row being modified).
  select coalesce(sum(quantity), 0)
    into v_active_qty
    from public.event_tickets
   where event_id = new.event_id
     and status in ('reserved', 'paid')
     and id <> new.id;

  if v_active_qty + new.quantity > v_capacity then
    raise exception
      'event % is at capacity (capacity=%, active_qty=%, requested=%)',
      new.event_id, v_capacity, v_active_qty, new.quantity;
  end if;

  return new;
end;
$$;

-- Trigger name sorts alphabetically before check_event_tenant so it fires
-- first; both checks reject invalid rows regardless of order (see note 6).
create trigger event_tickets_check_capacity
  before insert or update on public.event_tickets
  for each row execute function public.check_event_capacity();

-- ---------------------------------------------------------------------------
-- 4. Cross-tenant integrity trigger
--    Ensures that event_id belongs to the same tenant as the ticket row.
--    Fires BEFORE INSERT OR UPDATE (fires after event_tickets_check_capacity
--    alphabetically; both reject bad rows regardless of order — see note 6).
-- ---------------------------------------------------------------------------
create or replace function public.check_event_ticket_event_tenant()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_event_tenant_id uuid;
begin
  select tenant_id
    into v_event_tenant_id
    from public.events
   where id = new.event_id;

  if v_event_tenant_id is null then
    raise exception 'event % does not exist', new.event_id;
  end if;

  if v_event_tenant_id <> new.tenant_id then
    raise exception
      'event % belongs to tenant % but event_ticket tenant_id is %',
      new.event_id, v_event_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger event_tickets_check_event_tenant
  before insert or update on public.event_tickets
  for each row execute function public.check_event_ticket_event_tenant();

-- ---------------------------------------------------------------------------
-- 5. Guard trigger: restrict visitor UPDATE to reserved → cancelled only
--
--    RLS WITH CHECK enforces what the new status must be, but cannot compare
--    OLD vs NEW for arbitrary column mutations.  This trigger fills that gap:
--    for any caller that is neither a tenant role nor super_admin it
--      (a) rejects changes to any column other than status, and
--      (b) only allows the transition 'reserved' → 'cancelled'.
--    Paid tickets can only be cancelled by staff or the Stripe refund webhook.
--
--    Service-role callers (the TASK-023 server-side API and TASK-030 Stripe
--    webhook) bypass this guard via the JWT-claims mechanism from 0006.
-- ---------------------------------------------------------------------------
create or replace function public.guard_visitor_ticket_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- Trusted backend (service role) bypasses the visitor guard entirely.
  if nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' = 'service_role' then
    return new;
  end if;

  -- Tenant-role callers and super_admin may mutate freely.
  if public.has_tenant_role(old.tenant_id) then
    return new;
  end if;

  -- Immutability: reject changes to any column other than status.
  if new.tenant_id         is distinct from old.tenant_id         or
     new.event_id          is distinct from old.event_id          or
     new.user_id           is distinct from old.user_id           or
     new.buyer_name        is distinct from old.buyer_name        or
     new.buyer_email       is distinct from old.buyer_email       or
     new.buyer_phone       is distinct from old.buyer_phone       or
     new.quantity          is distinct from old.quantity          or
     new.unit_price_cents  is distinct from old.unit_price_cents  or
     new.currency          is distinct from old.currency          or
     new.payment_ref       is distinct from old.payment_ref
  then
    raise exception
      'permission denied: visitors may only change the status column of an event ticket';
  end if;

  -- Only allow reserved → cancelled.
  if old.status <> 'reserved' then
    raise exception
      'permission denied: ticket in status ''%'' cannot be self-cancelled by a visitor',
      old.status;
  end if;

  if new.status <> 'cancelled' then
    raise exception
      'permission denied: visitors may only cancel reserved tickets (status must be ''cancelled'')';
  end if;

  return new;
end;
$$;

-- Fires BEFORE UPDATE only; alphabetically after check_event_tenant which is
-- correct — structural checks run first, guard runs last.
create trigger event_tickets_guard_visitor_update
  before update on public.event_tickets
  for each row execute function public.guard_visitor_ticket_update();

-- ---------------------------------------------------------------------------
-- 6. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.events        enable row level security;
alter table public.event_tickets enable row level security;

-- ---------------------------------------------------------------------------
-- 7. RLS policies — events
--
-- Policy matrix:
--   anon + authenticated (public)  | SELECT | is_published=true AND tenant active
--   restaurant_owner / staff       | SELECT | all own-tenant rows (drafts visible)
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Public read: published events whose tenant is active.
create policy "events: public read published"
  on public.events
  for select
  to anon, authenticated
  using (
    is_published = true
    and exists (
      select 1
      from public.tenants
      where id = events.tenant_id
        and status = 'active'
    )
  );

-- Owner / staff read: all own-tenant rows regardless of is_published.
create policy "events: tenant role read own"
  on public.events
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert.
create policy "events: tenant role insert own"
  on public.events
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update.
create policy "events: tenant role update own"
  on public.events
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete.
create policy "events: tenant role delete own"
  on public.events
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "events: super_admin all"
  on public.events
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 8. RLS policies — event_tickets
--
-- Policy matrix:
--   anon                           | (none) — PII; guest purchases go via
--                                  |          service-role API (TASK-023)
--   authenticated visitor          | SELECT | own rows (user_id = auth.uid())
--   authenticated visitor          | INSERT | own rows, status='reserved',
--                                  |         tenant active, event published;
--                                  |         unit_price_cents snapshot integrity
--                                  |         enforced in TASK-023 API layer;
--                                  |         capacity enforced by DB trigger
--   authenticated visitor          | UPDATE | own reserved tickets → cancelled only
--                                  |         (column immutability by guard trigger)
--   authenticated visitor          | DELETE | (none)
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Visitor read: authenticated users may read their own ticket rows only.
-- No anon read — event_tickets contain PII (buyer_name, buyer_email, etc.).
create policy "event_tickets: visitor select own"
  on public.event_tickets
  for select
  to authenticated
  using (user_id = auth.uid());

-- Visitor insert: authenticated users may purchase tickets for themselves on
-- active tenants, for published events, with initial status='reserved'.
-- unit_price_cents snapshot is validated by the TASK-023 API; the DB cannot
-- verify it in RLS without a TOCTOU-prone subquery on events.price_cents.
-- Capacity is enforced by the check_event_capacity BEFORE INSERT trigger.
create policy "event_tickets: visitor insert own"
  on public.event_tickets
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'reserved'
    and exists (
      select 1
      from public.events e
      join public.tenants t on t.id = e.tenant_id
      where e.id = event_tickets.event_id
        and e.is_published = true
        and t.status = 'active'
    )
  );

-- Visitor update: authenticated users may cancel their own reserved tickets.
-- Column immutability (only status may change) and the exact allowed transition
-- (reserved → cancelled) are enforced by the guard_visitor_ticket_update trigger.
create policy "event_tickets: visitor cancel own"
  on public.event_tickets
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and status = 'reserved'
  )
  with check (
    user_id = auth.uid()
    and status = 'cancelled'
  );

-- Owner / staff read: all own-tenant ticket rows (B2B dashboard).
create policy "event_tickets: tenant role read own"
  on public.event_tickets
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert: create tickets on behalf of guests / walk-ins.
create policy "event_tickets: tenant role insert own"
  on public.event_tickets
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update: may modify any ticket for their tenant.
create policy "event_tickets: tenant role update own"
  on public.event_tickets
  for update
  to authenticated
  using (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete: may remove ticket rows for their tenant.
create policy "event_tickets: tenant role delete own"
  on public.event_tickets
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "event_tickets: super_admin all"
  on public.event_tickets
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
