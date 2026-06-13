import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import type { RestaurantEvent, EventTicket } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long (in minutes) a 'reserved' ticket hold is considered valid before
 * it is eligible to be expired by expireStaleReservedTickets.
 *
 * This constant lives in event-queries.ts (a "server-only" module) so it can
 * be imported from event-actions.ts ("use server") without a circular dependency.
 * "use server" files may only export async functions, so constants must reside
 * outside them.
 *
 * A cron job / Stripe webhook (TASK-030) will harden this expiry mechanism later.
 */
export const HOLD_MINUTES = 30;

// ---------------------------------------------------------------------------
// Public composite types
// ---------------------------------------------------------------------------

/**
 * A published event augmented with the number of remaining tickets.
 * Used by the B2C event listing page (TASK-025).
 */
export interface PublicEventWithAvailability extends RestaurantEvent {
  /** Tickets still available: capacity − (sum of reserved+paid quantity). */
  remaining: number;
}

/**
 * An event row enriched with sold-ticket and revenue data.
 * Used by the B2B dashboard (TASK-024).
 */
export interface EventWithStats extends RestaurantEvent {
  /** Total quantity across reserved+paid tickets for this event. */
  sold: number;
  /** Total revenue in cents across PAID tickets only (quantity*unit_price_cents). */
  revenue_cents: number;
}

/**
 * Ticket row with the parent event's title and start time joined in.
 * Used by getMyTickets.
 */
export interface EventTicketWithEvent extends EventTicket {
  event: {
    title: string;
    starts_at: string;
  };
}

/**
 * Availability snapshot for a single event.
 */
export interface EventAvailability {
  capacity: number;
  sold: number;
  remaining: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shared staff-auth check used by all dashboard query functions.
 * Returns the profile when the caller is restaurant_owner, restaurant_staff,
 * or super_admin; returns null otherwise.
 *
 * super_admin is allowed here because dashboard queries do not double-scope
 * writes to profile.tenant_id - they are read-only and RLS handles visibility.
 */
async function requireStaffOrAdmin() {
  const profile = await getProfile();
  if (!profile) return null;
  if (
    profile.role !== "restaurant_owner" &&
    profile.role !== "restaurant_staff" &&
    profile.role !== "super_admin"
  ) {
    return null;
  }
  return profile;
}

// ---------------------------------------------------------------------------
// expireStaleReservedTickets
// ---------------------------------------------------------------------------

/**
 * Cancels 'reserved' tickets that are older than HOLD_MINUTES and have no
 * payment_ref (i.e. the hold was never converted to a paid ticket and no
 * Stripe session was ever initiated).
 *
 * Uses the admin (service-role) client because:
 *   - Visitors may only cancel their own reserved tickets via session client.
 *   - This sweep needs to cancel ANY tenant's stale holds, including those
 *     inserted by direct-DB visitors who bypassed the API (they will also
 *     have no payment_ref and are thus neutralised within HOLD_MINUTES).
 *
 * Called lazily at the start of purchaseTickets and getEventAvailability.
 * A proper cron job / Stripe webhook (TASK-030) should call this periodically
 * to handle cases where the purchase flow is never reached.
 *
 * SECURITY NOTE: Direct-DB visitor inserts that bypass this API can squat
 * capacity with an attacker-chosen unit_price_cents, but since those rows
 * will never have a payment_ref set, this sweep will cancel them within
 * HOLD_MINUTES - effectively neutralising the capacity-squatting attack
 * within the hold window.
 *
 * @param eventId Optional UUID to scope the sweep to a single event (faster
 *                on the hot path); omit to sweep all events for all tenants.
 */
export async function expireStaleReservedTickets(eventId?: string): Promise<void> {
  const adminClient = createAdminClient();

  const cutoffISO = new Date(
    Date.now() - HOLD_MINUTES * 60_000
  ).toISOString();

  let query = adminClient
    .from("event_tickets")
    .update({ status: "cancelled" })
    .eq("status", "reserved")
    .lt("created_at", cutoffISO)
    .is("payment_ref", null);

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  // Errors are intentionally swallowed here - expiry is best-effort and
  // should not block the caller (purchase flow, availability check).
  await query;
}

// ---------------------------------------------------------------------------
// getPublicEvents
// ---------------------------------------------------------------------------

/**
 * Returns all published, upcoming events for a tenant, ordered by starts_at.
 * Augmented with a per-event `remaining` ticket count.
 *
 * Authorization:
 *   - Uses the caller's session client (RLS enforces is_published=true and
 *     tenant status=active for the events table).
 *
 * Remaining-count strategy:
 *   - RLS hides event_tickets rows from anonymous/visitor callers (no anon
 *     SELECT policy; visitors may only see their own rows).  We therefore use
 *     the admin (service-role) client to sum only (event_id, quantity, status)
 *     - no PII columns - across reserved+paid tickets for the events in the
 *     result set, then aggregate in JS.  This mirrors the pattern used in
 *     TASK-019's getAvailabilitySlots where admin client reads booking
 *     occupancy to prevent phantom-free slots.
 *
 * @param tenantId UUID of the tenant whose events to return.
 */
export async function getPublicEvents(
  tenantId: string
): Promise<PublicEventWithAvailability[]> {
  const supabase = createClient();

  const nowISO = new Date().toISOString();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_published", true)
    .gte("starts_at", nowISO)
    .order("starts_at", { ascending: true });

  if (error || !data || data.length === 0) return [];

  const events = data as RestaurantEvent[];
  const eventIds = events.map((e) => e.id);

  // Fetch occupancy via admin client (PII-free columns only).
  // Admin client is required because RLS hides other visitors' tickets from
  // anon/visitor session clients - see JSDoc above.
  const adminClient = createAdminClient();

  const { data: ticketData } = await adminClient
    .from("event_tickets")
    .select("event_id, quantity, status")
    .in("event_id", eventIds)
    .in("status", ["reserved", "paid"]);

  type TicketRow = { event_id: string; quantity: number; status: string };
  const tickets = (ticketData ?? []) as TicketRow[];

  // Aggregate sold quantity per event in JS (avoids a GROUP BY round-trip).
  const soldByEvent = new Map<string, number>();
  for (const t of tickets) {
    soldByEvent.set(t.event_id, (soldByEvent.get(t.event_id) ?? 0) + t.quantity);
  }

  return events.map((ev) => {
    const sold = soldByEvent.get(ev.id) ?? 0;
    return {
      ...ev,
      remaining: Math.max(0, ev.capacity - sold),
    };
  });
}

// ---------------------------------------------------------------------------
// getEventsForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns ALL events (including unpublished drafts) for a tenant, enriched
 * with per-event sold counts and paid revenue.
 * Intended for the B2B staff/owner dashboard (TASK-024).
 *
 * Authorization:
 *   - restaurant_owner / restaurant_staff: profile.tenant_id must match tenantId.
 *   - super_admin: may access any tenant.
 *   - All other callers receive an empty array.
 *   RLS (tenant role read own) provides the database-layer backstop.
 *
 * Staff RLS allows seeing all event_tickets for their own tenant, so the
 * session client is sufficient for the occupancy query here (no admin client
 * needed unlike the public path).
 *
 * @param tenantId UUID of the tenant.
 */
export async function getEventsForDashboard(
  tenantId: string
): Promise<EventWithStats[]> {
  const profile = await requireStaffOrAdmin();
  if (!profile) return [];

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  const supabase = createClient();

  // Load all events for the tenant (staff RLS sees drafts too).
  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: true });

  if (eventError || !eventData || eventData.length === 0) return [];

  const events = eventData as RestaurantEvent[];
  const eventIds = events.map((e) => e.id);

  // Load ticket occupancy - staff RLS sees all tenant tickets.
  const { data: ticketData } = await supabase
    .from("event_tickets")
    .select("event_id, quantity, status, unit_price_cents")
    .in("event_id", eventIds)
    .in("status", ["reserved", "paid"]);

  type TicketRow = {
    event_id: string;
    quantity: number;
    status: string;
    unit_price_cents: number;
  };
  const tickets = (ticketData ?? []) as TicketRow[];

  // Aggregate sold + revenue per event in JS.
  const soldByEvent = new Map<string, number>();
  const revenueByEvent = new Map<string, number>();

  for (const t of tickets) {
    soldByEvent.set(t.event_id, (soldByEvent.get(t.event_id) ?? 0) + t.quantity);
    if (t.status === "paid") {
      revenueByEvent.set(
        t.event_id,
        (revenueByEvent.get(t.event_id) ?? 0) + t.quantity * t.unit_price_cents
      );
    }
  }

  return events.map((ev) => ({
    ...ev,
    sold: soldByEvent.get(ev.id) ?? 0,
    revenue_cents: revenueByEvent.get(ev.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// getEventTicketsForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns all ticket rows for a specific event, ordered by created_at desc.
 * Intended for the B2B attendee list view (TASK-024).
 *
 * Authorization: same double-scope as getEventsForDashboard.
 *
 * @param tenantId UUID of the tenant (prevents cross-tenant access).
 * @param eventId  UUID of the event.
 */
export async function getEventTicketsForDashboard(
  tenantId: string,
  eventId: string
): Promise<EventTicket[]> {
  const profile = await requireStaffOrAdmin();
  if (!profile) return [];

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as EventTicket[];
}

// ---------------------------------------------------------------------------
// getMyTickets
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated visitor's own tickets, most recent first.
 * Each ticket includes the parent event's title and starts_at for display.
 *
 * Authorization: requires an authenticated session.  RLS enforces that only
 * rows where user_id = auth.uid() are returned.
 *
 * Returns an empty array when the caller is unauthenticated or has no tickets.
 */
export async function getMyTickets(): Promise<EventTicketWithEvent[]> {
  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return [];

  const { data, error } = await supabase
    .from("event_tickets")
    .select("*, events!inner(title, starts_at)")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  // Map the nested join result into a flat, type-safe shape.
  type RawRow = Omit<EventTicket, "event_id"> & {
    event_id: string;
    events: { title: string; starts_at: string };
  };

  return (data as RawRow[]).map((row) => {
    const { events: eventJoin, ...ticket } = row;
    return {
      ...(ticket as EventTicket),
      event: {
        title: eventJoin.title,
        starts_at: eventJoin.starts_at,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// getEventAvailability
// ---------------------------------------------------------------------------

/**
 * Returns { capacity, sold, remaining } for a single event.
 *
 * Calls expireStaleReservedTickets(eventId) first so that timed-out holds do
 * not inflate the "sold" count and block legitimate purchases.
 *
 * Uses the admin (service-role) client:
 *   - Anon callers have no SELECT policy on event_tickets (PII table).
 *   - Even authenticated visitors can only see their own rows, so the sum
 *     would be wrong for any other visitor's holds.
 *   Only (event_id, quantity, status) columns are read - no PII.
 *
 * @param eventId UUID of the event.
 */
export async function getEventAvailability(
  eventId: string
): Promise<EventAvailability | null> {
  // Expire stale holds for this event before computing availability.
  await expireStaleReservedTickets(eventId);

  const adminClient = createAdminClient();

  // Load the event capacity first.
  const { data: eventData, error: eventError } = await adminClient
    .from("events")
    .select("capacity")
    .eq("id", eventId)
    .single();

  if (eventError || !eventData) return null;

  const capacity = (eventData as { capacity: number }).capacity;

  // Sum active (reserved+paid) ticket quantities.
  const { data: ticketData, error: ticketError } = await adminClient
    .from("event_tickets")
    .select("quantity")
    .eq("event_id", eventId)
    .in("status", ["reserved", "paid"]);

  if (ticketError) return null;

  const sold = ((ticketData ?? []) as { quantity: number }[]).reduce(
    (acc, row) => acc + row.quantity,
    0
  );

  return {
    capacity,
    sold,
    remaining: Math.max(0, capacity - sold),
  };
}
