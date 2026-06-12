-- =============================================================================
-- 0009_orders.sql
-- Orders schema: in-session (dine-in), delivery, and banquet pre-order flows.
-- Covers the orders table (one row per order) and order_items (dish snapshot
-- lines) with full RLS, cross-tenant integrity triggers, and a visitor-guard
-- trigger that mirrors the 0006/0007 pattern.
--
-- Design notes
-- ============
-- 1. tenant_id is DENORMALIZED onto order_items (not just on orders) so that
--    RLS policies and indexes on order_items never need to join to orders.
--    A BEFORE INSERT OR UPDATE trigger (check_order_item_order_tenant) ensures
--    the referenced order always belongs to the same tenant as the item row,
--    preventing cross-tenant data leakage at the DB layer.
--
-- 2. order_type discriminant drives three distinct PLAN flows:
--      'in_session'  — dine-in order tied to a physical table.
--      'delivery'    — off-premise order with a delivery address and zone.
--      'banquet'     — pre-order tied to a reservation (deposit in TASK-031).
--    The table carries type-specific FK columns for each flow; a DB CHECK
--    constraint enforces that delivery orders always supply a delivery_address.
--    table_id / reservation_id are intentionally left nullable even for their
--    respective types: a table may be freed (SET NULL on delete) and a banquet
--    order may be placed before a reservation is linked or after its deletion.
--    These soft business-rules are validated at the API layer (TASK-029).
--
-- 3. Money columns on orders are all snapshots taken at order creation time:
--      subtotal_cents     — sum of (unit_price_cents * quantity) across items.
--      delivery_fee_cents — snapshot of the resolved delivery fee (zone
--                           fee_override_cents if set, else settings
--                           base_fee_cents; free_delivery_over_cents threshold
--                           applied by TASK-029 before insert).
--      total_cents        — subtotal_cents + delivery_fee_cents.
--    The equality total_cents = subtotal_cents + delivery_fee_cents is enforced
--    by a DB CHECK constraint.  Discounts and promotions are out of scope for
--    this schema version; when introduced they will add a discount_cents column
--    and the constraint will be relaxed.  For now the equality guarantees
--    financial integrity without API trust.
--    currency is snapshotted from delivery_settings.currency (or tenant
--    settings) at order time by TASK-029.
--    Price correctness of order_items (unit_price_cents matching live dish
--    prices) is validated in the TASK-029 API layer — the same accepted
--    pattern as TASK-023 / TASK-026 for event tickets and delivery fees; RLS
--    cannot read dishes.price_cents at INSERT time without a TOCTOU-prone
--    subquery.
--
-- 4. Status lifecycle.  Allowed transitions (enforced at the API / guard layer):
--
--      pending  ──▶  confirmed  ──▶  preparing  ──▶  ready
--                                                       │
--                               ┌─────────────────────┤
--                               │ (delivery only)      ▼
--                               │               out_for_delivery
--                               │                       │
--                               └───────────────────────┤
--                                                        ▼
--                                                    completed
--
--      Any non-terminal status  ──▶  cancelled
--      completed / refunded           ──  terminal (no further transitions)
--      cancelled  ──▶  (terminal)
--      refunded   ──▶  (terminal — set by Stripe webhook, TASK-030)
--
--    DB-level: the guard trigger restricts visitors to pending→cancelled only.
--    Full transition validation is the API layer's responsibility (TASK-029).
--
-- 5. Anonymous / guest order creation is NOT exposed through RLS.
--    Unauthenticated orders go through the TASK-029 server-side API route that
--    uses the service role to bypass RLS, matching the 0006/0007 pattern.
--
-- 6. The guard_visitor_order_update BEFORE UPDATE trigger restricts visitor
--    (non-tenant-role) callers to a single allowed mutation: status only,
--    and only the pending → cancelled transition.  Service-role callers bypass
--    the guard via the same JWT-claims mechanism as 0006/0007:
--    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
--    = 'service_role'.
--
-- 7. order_items immutability for visitors is enforced entirely via RLS: there
--    are no visitor UPDATE or DELETE policies on order_items.  A trigger is not
--    needed because RLS denial is the correct layer for this — the trigger would
--    only add noise.  Staff updates to items (quantity corrections, etc.) flow
--    through the tenant-role UPDATE policy.
--
-- 8. Cross-tenant FK integrity: four separate nullable FK columns on orders each
--    require a cross-tenant check.  Following the 0007 idiom a single function
--    check_order_fk_tenants handles all four in one trigger; each nullable FK
--    is only checked when non-null, matching the 0006 check_reservation_table_tenant
--    pattern.
--
-- 9. Trigger alphabetical firing order on orders (BEFORE triggers fire
--    alphabetically by trigger name):
--      orders_check_fk_tenants        — fires 1st (INSERT OR UPDATE)
--      orders_guard_visitor_update    — fires 2nd (UPDATE only)
--    On order_items:
--      order_items_check_order_tenant — fires 1st (INSERT OR UPDATE)
--
-- 10. All helper functions follow the 0001–0008 convention: SECURITY DEFINER
--     with search_path = '' and fully-qualified object references.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id             uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed — order_items also carry tenant_id and the
  -- check_order_item_order_tenant trigger keeps them consistent.
  tenant_id      uuid        not null
                   references public.tenants(id) on delete cascade,

  -- Discriminant for the three PLAN order flows.
  order_type     text        not null
                   constraint orders_order_type_values
                   check (order_type in ('in_session', 'delivery', 'banquet')),

  -- Lifecycle status (see design note 4 for transition rules).
  -- 'pending'         — created, not yet accepted by the kitchen.
  -- 'confirmed'       — kitchen accepted; preparation not yet started.
  -- 'preparing'       — kitchen is actively preparing the order.
  -- 'ready'           — order is ready for pickup / table service.
  -- 'out_for_delivery'— delivery orders only; en route to customer.
  -- 'completed'       — terminal: delivered / served / collected.
  -- 'cancelled'       — terminal: cancelled by visitor or staff.
  -- 'refunded'        — terminal: payment reversed via Stripe (TASK-030).
  -- Transition validation is at the API layer (TASK-029); guard trigger
  -- enforces visitor self-cancellation scope (pending → cancelled only).
  status         text        not null default 'pending'
                   constraint orders_status_values
                   check (status in (
                     'pending', 'confirmed', 'preparing', 'ready',
                     'out_for_delivery', 'completed', 'cancelled', 'refunded'
                   )),

  -- Optional: links the order to a registered auth user.
  -- NULL = guest order (created via service-role API in TASK-029).
  -- SET NULL when the user account is deleted.
  user_id        uuid
                   references auth.users(id) on delete set null,

  -- Customer PII (snapshot at order time — mirrors event_tickets buyer_* pattern).
  -- Visibility restricted to the customer themselves and tenant staff via RLS.
  customer_name  text        not null
                   constraint orders_customer_name_length
                   check (char_length(customer_name) between 1 and 120),

  -- No format check in DB (zod/API layer handles format validation).
  customer_email text
                   constraint orders_customer_email_length
                   check (
                     customer_email is null
                     or char_length(customer_email) <= 254
                   ),

  customer_phone text
                   constraint orders_customer_phone_length
                   check (
                     customer_phone is null
                     or char_length(customer_phone) <= 40
                   ),

  -- -------------------------------------------------------------------------
  -- Type-specific link columns
  -- -------------------------------------------------------------------------

  -- 'in_session': physical table (nullable — table may be freed after order
  --   creation; enforced soft in TASK-029 API).
  -- SET NULL when the floor_table row is deleted (order history preserved).
  table_id       uuid
                   references public.floor_tables(id) on delete set null,

  -- 'delivery': delivery zone the order was placed in.
  -- SET NULL when the zone is deleted (order history preserved).
  delivery_zone_id uuid
                   references public.delivery_zones(id) on delete set null,

  -- 'delivery': customer's delivery address (max 500 characters).
  -- Enforced non-null for delivery orders by CHECK below.
  delivery_address text
                   constraint orders_delivery_address_length
                   check (
                     delivery_address is null
                     or char_length(delivery_address) <= 500
                   ),

  -- 'banquet': linked reservation (optional — may not exist yet at order time;
  --   SET NULL when the reservation is deleted).
  reservation_id uuid
                   references public.reservations(id) on delete set null,

  -- General notes (banquet instructions, dietary info, special requests).
  notes          text
                   constraint orders_notes_length
                   check (
                     notes is null
                     or char_length(notes) <= 2000
                   ),

  -- -------------------------------------------------------------------------
  -- Type ↔ required-field enforcement
  -- -------------------------------------------------------------------------
  -- Delivery orders MUST provide a delivery_address.  This is DB-enforceable
  -- without being brittle (the address is always required regardless of zone).
  -- in_session table_id and banquet reservation_id are intentionally left
  -- nullable at the DB layer (see design note 2): the table may be freed and
  -- the reservation may not exist yet or may be created after the order.
  constraint orders_delivery_address_required
    check (
      order_type <> 'delivery'
      or delivery_address is not null
    ),

  -- -------------------------------------------------------------------------
  -- Money snapshots (all in integer cents — see design note 3)
  -- -------------------------------------------------------------------------

  -- Sum of (unit_price_cents * quantity) across all order_items rows.
  -- Range 0–100,000,000 (~$1M maximum basket; guards against data errors).
  subtotal_cents    integer   not null
                     constraint orders_subtotal_cents_range
                     check (subtotal_cents between 0 and 100000000),

  -- Snapshot of the resolved delivery fee at order creation time.
  -- 0 for non-delivery orders (schema default).
  -- Resolution logic (zone fee_override_cents vs. settings base_fee_cents,
  -- free_delivery_over_cents threshold) is TASK-029's responsibility.
  -- Range 0–1,000,000 (matches delivery_zones.fee_override_cents upper bound).
  delivery_fee_cents integer  not null default 0
                     constraint orders_delivery_fee_cents_range
                     check (delivery_fee_cents between 0 and 1000000),

  -- subtotal_cents + delivery_fee_cents.  Enforced by DB CHECK to guarantee
  -- financial integrity without relying on API correctness.  When discounts
  -- are introduced (future) this constraint will be relaxed and a
  -- discount_cents column added.
  total_cents       integer   not null
                     constraint orders_total_cents_range
                     check (total_cents between 0 and 100000000),

  constraint orders_total_equals_subtotal_plus_fee
    check (total_cents = subtotal_cents + delivery_fee_cents),

  -- ISO 4217 currency code — snapshotted at order time from delivery_settings
  -- or tenant configuration.  Must stay in sync with the allowlist used by
  -- events / delivery (same Stripe allowlist).
  currency          text      not null
                     constraint orders_currency_values
                     check (currency in ('usd', 'eur', 'gbp', 'rub')),

  -- -------------------------------------------------------------------------
  -- Banquet / Stripe columns
  -- -------------------------------------------------------------------------

  -- Banquet deposit amount in cents (TASK-031; 0 = no deposit required).
  -- Range 0–100,000,000.
  deposit_cents     integer   not null default 0
                     constraint orders_deposit_cents_range
                     check (deposit_cents between 0 and 100000000),

  -- Stripe payment / charge identifier; null until payment is initiated
  -- (TASK-030).  Mirrors event_tickets.payment_ref.
  payment_ref       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Drives the B2B dashboard list: all orders for a tenant in reverse
-- chronological order (the primary operations view).
create index orders_tenant_created_idx
  on public.orders (tenant_id, created_at desc);

-- Drives "orders by status" dashboard filter / kitchen display.
create index orders_tenant_status_idx
  on public.orders (tenant_id, status);

-- Drives the "my orders" visitor query: orders owned by a user.
create index orders_user_id_idx
  on public.orders (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. order_items
--    One row per dish line in an order.  Dish data is snapshot at order-
--    creation time so that historical orders survive menu changes.
-- ---------------------------------------------------------------------------
create table public.order_items (
  id               uuid        primary key default gen_random_uuid(),

  -- Denormalized for RLS speed — enforced to match order's tenant_id by the
  -- check_order_item_order_tenant trigger below.
  tenant_id        uuid        not null
                     references public.tenants(id) on delete cascade,

  order_id         uuid        not null
                     references public.orders(id) on delete cascade,

  -- Nullable: snapshot survives dish deletion (SET NULL + snapshot columns).
  dish_id          uuid
                     references public.dishes(id) on delete set null,

  -- Snapshot of dishes.name at order time (1–160 characters).
  dish_name        text        not null
                     constraint order_items_dish_name_length
                     check (char_length(dish_name) between 1 and 160),

  -- Snapshot of dishes.price_cents at order time.
  -- 0 = complimentary item.  Range 0–10,000,000 (matches events allowlist).
  unit_price_cents integer     not null
                     constraint order_items_unit_price_cents_range
                     check (unit_price_cents between 0 and 10000000),

  -- Quantity of this dish in the order (1–100).
  quantity         integer     not null
                     constraint order_items_quantity_range
                     check (quantity between 1 and 100),

  -- Items are immutable for visitors after creation (no visitor UPDATE/DELETE
  -- RLS policies exist on this table — see design note 7).  Staff edits
  -- (corrections, removals) flow through the tenant-role policies.
  created_at       timestamptz not null default now()
  -- No updated_at: items are write-once from the visitor perspective; staff
  -- edits via the admin client do not need an audit timestamp here (the
  -- parent order's updated_at reflects changes).
);

-- Drives the order-detail query: all items for a given order (the primary
-- read path for both visitors and kitchen display).
create index order_items_order_id_idx
  on public.order_items (order_id);

-- Drives tenant-scoped order-item queries (e.g. aggregate reports).
create index order_items_tenant_id_idx
  on public.order_items (tenant_id);

-- ---------------------------------------------------------------------------
-- 3. Cross-tenant FK integrity for orders
--    Four nullable FK columns on orders each require a cross-tenant check:
--      table_id        → floor_tables.tenant_id
--      delivery_zone_id→ delivery_zones.tenant_id
--      reservation_id  → reservations.tenant_id
--    (user_id references auth.users which has no tenant_id, so no check needed.)
--    A single BEFORE INSERT OR UPDATE trigger handles all three nullable FKs
--    following the 0006 check_reservation_table_tenant idiom: each FK is only
--    checked when non-null.
-- ---------------------------------------------------------------------------
create or replace function public.check_order_fk_tenants()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_fk_tenant_id uuid;
begin
  -- Check table_id → floor_tables.tenant_id
  if new.table_id is not null then
    select tenant_id
      into v_fk_tenant_id
      from public.floor_tables
     where id = new.table_id;

    if v_fk_tenant_id is null then
      raise exception 'floor_table % does not exist', new.table_id;
    end if;

    if v_fk_tenant_id <> new.tenant_id then
      raise exception
        'floor_table % belongs to tenant % but order tenant_id is %',
        new.table_id, v_fk_tenant_id, new.tenant_id;
    end if;
  end if;

  -- Check delivery_zone_id → delivery_zones.tenant_id
  if new.delivery_zone_id is not null then
    select tenant_id
      into v_fk_tenant_id
      from public.delivery_zones
     where id = new.delivery_zone_id;

    if v_fk_tenant_id is null then
      raise exception 'delivery_zone % does not exist', new.delivery_zone_id;
    end if;

    if v_fk_tenant_id <> new.tenant_id then
      raise exception
        'delivery_zone % belongs to tenant % but order tenant_id is %',
        new.delivery_zone_id, v_fk_tenant_id, new.tenant_id;
    end if;
  end if;

  -- Check reservation_id → reservations.tenant_id
  if new.reservation_id is not null then
    select tenant_id
      into v_fk_tenant_id
      from public.reservations
     where id = new.reservation_id;

    if v_fk_tenant_id is null then
      raise exception 'reservation % does not exist', new.reservation_id;
    end if;

    if v_fk_tenant_id <> new.tenant_id then
      raise exception
        'reservation % belongs to tenant % but order tenant_id is %',
        new.reservation_id, v_fk_tenant_id, new.tenant_id;
    end if;
  end if;

  return new;
end;
$$;

-- Fires before the guard trigger (alphabetically earlier).
create trigger orders_check_fk_tenants
  before insert or update on public.orders
  for each row execute function public.check_order_fk_tenants();

-- ---------------------------------------------------------------------------
-- 4. Cross-tenant integrity trigger for order_items
--    Ensures order_items.order_id references an order in the same tenant.
--    Mirrors check_event_ticket_event_tenant from 0007.
-- ---------------------------------------------------------------------------
create or replace function public.check_order_item_order_tenant()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_order_tenant_id uuid;
begin
  select tenant_id
    into v_order_tenant_id
    from public.orders
   where id = new.order_id;

  if v_order_tenant_id is null then
    raise exception 'order % does not exist', new.order_id;
  end if;

  if v_order_tenant_id <> new.tenant_id then
    raise exception
      'order % belongs to tenant % but order_item tenant_id is %',
      new.order_id, v_order_tenant_id, new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger order_items_check_order_tenant
  before insert or update on public.order_items
  for each row execute function public.check_order_item_order_tenant();

-- ---------------------------------------------------------------------------
-- 5. Guard trigger: restrict visitor UPDATE on orders to pending → cancelled
--
--    RLS WITH CHECK enforces what the new status must be, but cannot compare
--    OLD vs NEW for arbitrary column mutations.  This trigger fills that gap:
--    for any caller that is neither a tenant role nor super_admin it
--      (a) rejects changes to any column other than status, and
--      (b) only allows the transition 'pending' → 'cancelled'.
--    Orders in any status other than 'pending' cannot be self-cancelled by
--    visitors (confirmed/preparing/ready orders must be cancelled by staff).
--
--    Service-role callers (the TASK-029 server-side API and TASK-030 Stripe
--    webhook) bypass this guard via the JWT-claims mechanism from 0006/0007.
-- ---------------------------------------------------------------------------
create or replace function public.guard_visitor_order_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- Trusted backend (service role) bypasses the visitor guard entirely.
  -- nullif(..., '') guards against an empty string when the GUC is unset
  -- outside a request context (pg_cron, direct psql) — same as 0006/0007.
  if nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' = 'service_role' then
    return new;
  end if;

  -- Tenant-role callers and super_admin may mutate freely.
  if public.has_tenant_role(old.tenant_id) then
    return new;
  end if;

  -- Immutability: reject changes to any column other than status.
  if new.tenant_id          is distinct from old.tenant_id          or
     new.order_type         is distinct from old.order_type         or
     new.user_id            is distinct from old.user_id            or
     new.customer_name      is distinct from old.customer_name      or
     new.customer_email     is distinct from old.customer_email     or
     new.customer_phone     is distinct from old.customer_phone     or
     new.table_id           is distinct from old.table_id           or
     new.delivery_zone_id   is distinct from old.delivery_zone_id   or
     new.delivery_address   is distinct from old.delivery_address   or
     new.reservation_id     is distinct from old.reservation_id     or
     new.notes              is distinct from old.notes              or
     new.subtotal_cents     is distinct from old.subtotal_cents     or
     new.delivery_fee_cents is distinct from old.delivery_fee_cents or
     new.total_cents        is distinct from old.total_cents        or
     new.currency           is distinct from old.currency           or
     new.deposit_cents      is distinct from old.deposit_cents      or
     new.payment_ref        is distinct from old.payment_ref
  then
    raise exception
      'permission denied: visitors may only change the status column of an order';
  end if;

  -- Only allow pending → cancelled.
  if old.status <> 'pending' then
    raise exception
      'permission denied: order in status ''%'' cannot be self-cancelled by a visitor',
      old.status;
  end if;

  if new.status <> 'cancelled' then
    raise exception
      'permission denied: visitors may only cancel pending orders (status must be ''cancelled'')';
  end if;

  return new;
end;
$$;

-- Fires BEFORE UPDATE only; alphabetically after orders_check_fk_tenants
-- (structural cross-tenant check runs first, guard runs last — same order
-- rationale as 0007 note 6).
create trigger orders_guard_visitor_update
  before update on public.orders
  for each row execute function public.guard_visitor_order_update();

-- ---------------------------------------------------------------------------
-- 6. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- ---------------------------------------------------------------------------
-- 7. RLS policies — orders
--
-- Policy matrix:
--   anon                           | (none) — PII; guest orders go via
--                                  |          service-role API (TASK-029)
--   authenticated visitor          | SELECT | own rows (user_id = auth.uid())
--   authenticated visitor          | INSERT | own rows, status='pending',
--                                  |         tenant active;
--                                  |         money column integrity enforced
--                                  |         by the total_equals check and
--                                  |         in TASK-029 API layer;
--                                  |         guest inserts go via admin client
--                                  |         (same pattern as TASK-023)
--   authenticated visitor          | UPDATE | own pending orders → cancelled
--                                  |         (column immutability by trigger)
--   authenticated visitor          | DELETE | (none)
--   restaurant_owner / staff       | SELECT | all own-tenant rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK rebind)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Visitor read: authenticated users may read their own order rows only.
-- No anon read — orders contain PII (customer_name, customer_email, etc.).
create policy "orders: visitor select own"
  on public.orders
  for select
  to authenticated
  using (user_id = auth.uid());

-- Visitor insert: authenticated users may place orders for themselves on
-- active tenants with initial status='pending'.
-- Money column integrity (subtotal, delivery_fee, total equality) is partially
-- enforced by the orders_total_equals_subtotal_plus_fee DB CHECK; full price
-- re-verification against live dish prices is the TASK-029 API layer's job —
-- the DB cannot do this without a TOCTOU-prone subquery on dishes.price_cents.
-- Guest (unauthenticated) inserts go through the service-role API in TASK-029.
create policy "orders: visitor insert own"
  on public.orders
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from public.tenants
      where id = orders.tenant_id
        and status = 'active'
    )
  );

-- Visitor update: authenticated users may cancel their own pending orders.
-- Column immutability (only status may change) and the exact allowed transition
-- (pending → cancelled) are enforced by the guard_visitor_order_update trigger.
create policy "orders: visitor cancel own"
  on public.orders
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and status = 'pending'
  )
  with check (
    user_id = auth.uid()
    and status = 'cancelled'
  );

-- Owner / staff read: all own-tenant rows (B2B dashboard / kitchen display).
create policy "orders: tenant role read own"
  on public.orders
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert: create orders on behalf of walk-ins / phone orders.
-- WITH CHECK includes has_tenant_role(NEW.tenant_id) to prevent cross-tenant
-- rebind — mirrors the 0008 verifier-confirmed improvement.
create policy "orders: tenant role insert own"
  on public.orders
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update: may modify any order for their tenant.
-- WITH CHECK rebind protection: has_tenant_role(NEW.tenant_id) ensures the
-- tenant_id cannot be changed to another tenant the caller also belongs to.
create policy "orders: tenant role update own"
  on public.orders
  for update
  to authenticated
  using  (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete: may remove order rows for their tenant.
create policy "orders: tenant role delete own"
  on public.orders
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "orders: super_admin all"
  on public.orders
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 8. RLS policies — order_items
--
-- Policy matrix:
--   anon                           | (none) — no public item data exposed
--   authenticated visitor          | SELECT | parent order owned by auth.uid()
--   authenticated visitor          | INSERT | parent order belongs to them,
--                                  |         parent status='pending', tenant match
--   authenticated visitor          | UPDATE | (none) — items are immutable for
--                                  |          visitors; RLS denial suffices
--                                  |          (no guard trigger needed, see note 7)
--   authenticated visitor          | DELETE | (none)
--   restaurant_owner / staff       | SELECT | all own-tenant item rows
--   restaurant_owner / staff       | INSERT | own tenant (WITH CHECK)
--   restaurant_owner / staff       | UPDATE | own tenant (WITH CHECK rebind)
--   restaurant_owner / staff       | DELETE | own tenant
--   super_admin                    | ALL    | unrestricted
-- ---------------------------------------------------------------------------

-- Visitor read: authenticated users may read items belonging to their own orders.
-- EXISTS subquery joins back to orders via order_id and checks user_id = auth.uid().
-- No anon read — order_items are sensitive (dish quantities, prices).
create policy "order_items: visitor select own"
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where id = order_items.order_id
        and user_id = auth.uid()
    )
  );

-- Visitor insert: authenticated users may add items to their own pending orders.
-- Three conditions must all hold:
--   (a) the parent order belongs to the calling user,
--   (b) the parent order is still in 'pending' status (not yet confirmed),
--   (c) the item's tenant_id matches the parent order's tenant_id.
-- unit_price_cents snapshot integrity is the TASK-029 API layer's job.
create policy "order_items: visitor insert own"
  on public.order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders
      where id = order_items.order_id
        and user_id = auth.uid()
        and status = 'pending'
        and tenant_id = order_items.tenant_id
    )
  );

-- No visitor UPDATE policy — items are immutable for visitors after creation.
-- Enforced entirely by the absence of a policy (RLS default-deny).
-- See design note 7.

-- No visitor DELETE policy — visitors may not remove individual items; they
-- cancel the whole order instead.

-- Owner / staff read: all own-tenant item rows.
create policy "order_items: tenant role read own"
  on public.order_items
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner / staff insert: add items on behalf of walk-in / staff-entered orders.
create policy "order_items: tenant role insert own"
  on public.order_items
  for insert
  to authenticated
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff update: may modify items (quantity corrections, price overrides).
-- WITH CHECK rebind protection prevents changing tenant_id to a different tenant.
create policy "order_items: tenant role update own"
  on public.order_items
  for update
  to authenticated
  using  (public.has_tenant_role(tenant_id))
  with check (public.has_tenant_role(tenant_id));

-- Owner / staff delete: may remove individual items from orders.
create policy "order_items: tenant role delete own"
  on public.order_items
  for delete
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- super_admin unrestricted access.
create policy "order_items: super_admin all"
  on public.order_items
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 9. Column-level comments
--    Visible in psql \d+ and Supabase Studio.
-- ---------------------------------------------------------------------------
comment on table  public.orders is
  'Customer orders covering three flows: in_session (dine-in), delivery, and banquet pre-order.';

comment on column public.orders.order_type is
  'Discriminant: in_session = dine-in at a table; delivery = off-premise delivery; banquet = pre-order tied to a reservation.';

comment on column public.orders.status is
  'Lifecycle status.  Allowed visitor self-transition: pending → cancelled (guard trigger).  Full transition rules in design note 4.';

comment on column public.orders.delivery_fee_cents is
  'Snapshot of the resolved delivery fee at order creation.  Resolution (zone fee_override_cents vs. base_fee_cents, free_delivery_over_cents threshold) performed by TASK-029 API before insert.  0 for non-delivery orders.';

comment on column public.orders.total_cents is
  'Must equal subtotal_cents + delivery_fee_cents (enforced by orders_total_equals_subtotal_plus_fee CHECK).  Discounts modelled as separate column in a future migration.';

comment on column public.orders.deposit_cents is
  'Banquet deposit amount in cents.  0 = no deposit required.  Stripe integration in TASK-031.';

comment on column public.orders.payment_ref is
  'Stripe payment / charge identifier.  Null until payment is initiated (TASK-030).';

comment on table  public.order_items is
  'Dish snapshot lines for an order.  Dish data (name, price) is copied at order time and survives menu changes and dish deletion.';

comment on column public.order_items.dish_id is
  'References public.dishes(id) ON DELETE SET NULL.  Null after the source dish is deleted; dish_name / unit_price_cents snapshots preserve the historical line.';

comment on column public.order_items.unit_price_cents is
  'Snapshot of dishes.price_cents at order creation time.  Integrity against live prices enforced in TASK-029 API layer.';
