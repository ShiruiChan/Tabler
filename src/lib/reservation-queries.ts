import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import type {
  AvailabilityRule,
  ReservationSettings,
  Reservation,
  FloorTable,
} from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Public composite types
// ---------------------------------------------------------------------------

/**
 * A single bookable time slot returned by getAvailabilitySlots.
 *
 * `slot` is an ISO-8601 UTC datetime string for the slot start time.
 * `availableTableIds` lists the floor_table UUIDs that are free during this
 * slot's window (i.e. capacity >= partySize and no overlapping active booking).
 * `anyTableFree` is a convenience flag: true when availableTableIds is
 * non-empty.
 */
export interface AvailabilitySlot {
  /** ISO-8601 UTC datetime: when this slot starts. */
  slot: string;
  /** UUIDs of bookable tables that are free for this slot window. */
  availableTableIds: string[];
  /** True when at least one table is free for this slot. */
  anyTableFree: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a "HH:MM:SS" or "HH:MM" time string into { hours, minutes }.
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

/**
 * Builds a UTC Date from a YYYY-MM-DD date string and a "HH:MM:SS" time string.
 *
 * Availability rule times are treated as UTC.  Per-tenant timezone support is a
 * future concern — reservation_settings does not yet carry a timezone column.
 * When it does, callers should convert dateISO + time to the tenant's local
 * midnight before applying opens_at/closes_at.
 */
function utcDateFromParts(dateISO: string, timeStr: string): Date {
  const { hours, minutes } = parseTime(timeStr);
  // Pad hours/minutes to two digits for a valid ISO string.
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return new Date(`${dateISO}T${hh}:${mm}:00Z`);
}

// ---------------------------------------------------------------------------
// getAvailabilitySlots
// ---------------------------------------------------------------------------

/**
 * Computes the bookable time slots for a given tenant, calendar date, and
 * party size.
 *
 * Algorithm
 * ---------
 * 1. Load the availability_rules row for the weekday of `dateISO`.
 *    If none exists, or if the day is marked `is_closed`, return [].
 * 2. Load reservation_settings for the tenant (min/max advance, duration).
 * 3. Load all bookable floor_tables with capacity >= partySize.
 *    If no such tables exist, return [].
 * 4. Generate candidate slot start times from opens_at to
 *    (closes_at − last_seating_minutes), stepped by slot_minutes.
 * 5. Filter slots that violate min_advance_minutes or max_advance_days
 *    relative to `now`.
 * 6. Load all overlapping active (pending/confirmed) reservations for every
 *    candidate table in ONE query — covers the entire date window.
 *    Compute per-slot per-table overlap in JS (no N+1 queries).
 * 7. Return the filtered slot list with availability metadata.
 *
 * Timezone
 * --------
 * Availability rule times (opens_at / closes_at) are treated as UTC for now.
 * Per-tenant timezone support is a future concern; reservation_settings does
 * not carry a `timezone` column at this schema version.  When added, callers
 * should offset `dateISO` to the tenant's local date before calling this
 * function.
 *
 * Authorization: none — RLS public-read policies on availability_rules,
 * reservation_settings, and floor_tables enforce the active-tenant constraint.
 *
 * @param tenantId  UUID of the tenant whose slots to compute.
 * @param dateISO   Calendar date in YYYY-MM-DD format (UTC calendar day).
 * @param partySize Number of guests; only tables with capacity >= partySize
 *                  are considered.
 * @returns Array of AvailabilitySlot objects, empty when the day has no open
 *          slots or no suitable tables.
 */
export async function getAvailabilitySlots(
  tenantId: string,
  dateISO: string,
  partySize: number
): Promise<AvailabilitySlot[]> {
  const supabase = createClient();

  // 1. Determine weekday (0=Sun … 6=Sat) from the date string.
  //    Parse as UTC midnight to avoid local-timezone date shifting.
  const dateUtc = new Date(`${dateISO}T00:00:00Z`);
  const weekday = dateUtc.getUTCDay();

  // Load the availability rule for this weekday.
  const { data: ruleData, error: ruleError } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("weekday", weekday)
    .single();

  if (ruleError || !ruleData) return [];

  const rule = ruleData as AvailabilityRule;
  if (rule.is_closed) return [];

  // 2. Load reservation_settings for advance-window constraints.
  const { data: settingsData, error: settingsError } = await supabase
    .from("reservation_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();

  if (settingsError || !settingsData) return [];

  const settings = settingsData as ReservationSettings;

  // 3. Load bookable tables with sufficient capacity that belong to an active
  //    floor plan.  The inner join on floor_plans ensures tenant-role callers
  //    (who can see all floor_tables regardless of plan status) do not get
  //    tables from inactive/draft plans mixed into availability results.
  const { data: tablesData, error: tablesError } = await supabase
    .from("floor_tables")
    .select("id, capacity, floor_plans!inner(is_active)")
    .eq("tenant_id", tenantId)
    .eq("is_bookable", true)
    .gte("capacity", partySize)
    .eq("floor_plans.is_active", true);

  if (tablesError || !tablesData || tablesData.length === 0) return [];

  const candidateTables = tablesData as Pick<FloorTable, "id" | "capacity">[];
  const candidateTableIds = candidateTables.map((t) => t.id);

  // 4. Generate candidate slot start times (all in UTC).
  const opensAt = utcDateFromParts(dateISO, rule.opens_at);
  const closesAt = utcDateFromParts(dateISO, rule.closes_at);
  const lastSeatMs = rule.last_seating_minutes * 60_000;
  const slotStepMs = rule.slot_minutes * 60_000;
  const durationMs = settings.default_duration_minutes * 60_000;

  // Last allowable slot start = closes_at − last_seating_minutes.
  const lastSlotStart = new Date(closesAt.getTime() - lastSeatMs);

  const candidateSlots: Date[] = [];
  for (
    let t = opensAt.getTime();
    t <= lastSlotStart.getTime();
    t += slotStepMs
  ) {
    candidateSlots.push(new Date(t));
  }

  if (candidateSlots.length === 0) return [];

  // 5. Apply advance-window filters relative to "now".
  const now = new Date();
  const minAdvanceMs = settings.min_advance_minutes * 60_000;
  const maxAdvanceMs = settings.max_advance_days * 24 * 60 * 60_000;

  const openSlots = candidateSlots.filter((slotStart) => {
    const diffMs = slotStart.getTime() - now.getTime();
    return diffMs >= minAdvanceMs && diffMs <= maxAdvanceMs;
  });

  if (openSlots.length === 0) return [];

  // 6. Load all active reservations for candidate tables covering the full
  //    date window in ONE query (avoids N+1 for per-slot checks).
  //    We fetch every active reservation whose window overlaps the day window
  //    [opensAt, lastSlotStart + durationMs], then compute overlaps in JS.
  //
  //    WHY the admin client is required here:
  //    The `reservations` table has NO anon SELECT policy and authenticated
  //    visitors may only see their own rows (user_id = auth.uid()).  If this
  //    query ran through the session/anon client, every other party's bookings
  //    would be invisible — all slots would appear free regardless of actual
  //    occupancy, silently enabling double-booking even though the DB exclusion
  //    constraint only guards assigned-table rows.  The admin (service-role)
  //    client bypasses RLS so we see all pending/confirmed bookings.  Only the
  //    three non-PII scheduling columns (floor_table_id, starts_at, ends_at)
  //    are selected; no guest contact details are read.
  const adminClient = createAdminClient();
  const dayWindowStart = opensAt.toISOString();
  const dayWindowEnd = new Date(
    lastSlotStart.getTime() + durationMs
  ).toISOString();

  const { data: reservationsData } = await adminClient
    .from("reservations")
    .select("floor_table_id, starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .in("floor_table_id", candidateTableIds)
    .in("status", ["pending", "confirmed"])
    // Overlap condition: booking.starts_at < dayWindowEnd AND booking.ends_at > dayWindowStart
    .lt("starts_at", dayWindowEnd)
    .gt("ends_at", dayWindowStart);

  type ReservationRow = {
    floor_table_id: string;
    starts_at: string;
    ends_at: string;
  };

  const activeReservations = (reservationsData ?? []) as ReservationRow[];

  // Build a map: tableId → list of booked intervals { startMs, endMs }
  const bookedByTable = new Map<
    string,
    Array<{ startMs: number; endMs: number }>
  >();
  for (const res of activeReservations) {
    if (!res.floor_table_id) continue;
    const bucket = bookedByTable.get(res.floor_table_id) ?? [];
    bucket.push({
      startMs: new Date(res.starts_at).getTime(),
      endMs: new Date(res.ends_at).getTime(),
    });
    bookedByTable.set(res.floor_table_id, bucket);
  }

  // 7. For each open slot, determine which tables are free.
  return openSlots.map((slotStart) => {
    const slotStartMs = slotStart.getTime();
    const slotEndMs = slotStartMs + durationMs;

    const availableTableIds = candidateTableIds.filter((tableId) => {
      const booked = bookedByTable.get(tableId);
      if (!booked) return true; // no bookings at all → free
      // A booking overlaps if: booking.startMs < slotEndMs AND booking.endMs > slotStartMs
      return !booked.some(
        (b) => b.startMs < slotEndMs && b.endMs > slotStartMs
      );
    });

    return {
      slot: slotStart.toISOString(),
      availableTableIds,
      anyTableFree: availableTableIds.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// getReservationsForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns all reservations for a given tenant within a UTC datetime range.
 * Intended for the B2B staff/owner dashboard view.
 *
 * Authorization:
 *   - restaurant_owner / restaurant_staff: profile.tenant_id must match
 *     the requested tenantId.
 *   - super_admin: may access any tenant's reservations.
 *   - All other callers receive an empty array.
 *   RLS policies further enforce these rules at the database layer.
 *
 * @param tenantId  UUID of the tenant.
 * @param fromISO   Range start (inclusive) as ISO-8601 UTC datetime.
 * @param toISO     Range end (exclusive) as ISO-8601 UTC datetime.
 */
export async function getReservationsForDashboard(
  tenantId: string,
  fromISO: string,
  toISO: string
): Promise<Reservation[]> {
  const profile = await getProfile();
  if (!profile) return [];

  // Authorization: super_admin can access any tenant; owner/staff only their own.
  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  if (
    (profile.role === "restaurant_owner" ||
      profile.role === "restaurant_staff") &&
    !profile.tenant_id
  ) {
    return [];
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("starts_at", fromISO)
    .lt("starts_at", toISO)
    .order("starts_at", { ascending: true });

  if (error || !data) return [];
  return data as Reservation[];
}

// ---------------------------------------------------------------------------
// getAvailabilityRulesForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns all availability_rules for a given tenant ordered by weekday.
 * Intended for the B2B availability settings editor.
 *
 * Authorization: same double-scope as getReservationsForDashboard.
 */
export async function getAvailabilityRulesForDashboard(
  tenantId: string
): Promise<AvailabilityRule[]> {
  const profile = await getProfile();
  if (!profile) return [];

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  if (
    (profile.role === "restaurant_owner" ||
      profile.role === "restaurant_staff") &&
    !profile.tenant_id
  ) {
    return [];
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("weekday", { ascending: true });

  if (error || !data) return [];
  return data as AvailabilityRule[];
}

// ---------------------------------------------------------------------------
// getReservationSettingsForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns the reservation_settings row for a given tenant.
 * Intended for the B2B settings editor.
 *
 * Authorization: same double-scope as getReservationsForDashboard.
 * Returns null when unauthorized or the row is missing.
 */
export async function getReservationSettingsForDashboard(
  tenantId: string
): Promise<ReservationSettings | null> {
  const profile = await getProfile();
  if (!profile) return null;

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return null;
  }

  if (
    (profile.role === "restaurant_owner" ||
      profile.role === "restaurant_staff") &&
    !profile.tenant_id
  ) {
    return null;
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("reservation_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) return null;
  return data as ReservationSettings;
}

// ---------------------------------------------------------------------------
// getTablesForTenant
// ---------------------------------------------------------------------------

/**
 * Returns a minimal id→label map of all floor tables for a given tenant.
 * Used by the dashboard to resolve floor_table_id → label on reservations.
 *
 * Authorization: same double-scope as getReservationsForDashboard.
 */
export async function getTablesForTenant(
  tenantId: string
): Promise<{ id: string; label: string }[]> {
  const profile = await getProfile();
  if (!profile) return [];

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("floor_tables")
    .select("id, label")
    .eq("tenant_id", tenantId)
    .order("label", { ascending: true });

  if (error || !data) return [];
  return data as { id: string; label: string }[];
}

// ---------------------------------------------------------------------------
// getMyReservations
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated visitor's own reservations, ordered by starts_at
 * descending (most recent first).
 *
 * Authorization: requires an authenticated session.  RLS enforces that only
 * rows where user_id = auth.uid() are returned — this function adds no
 * additional application-layer filter beyond requiring sign-in.
 *
 * Returns an empty array when the caller is unauthenticated or has no
 * reservations.
 */
export async function getMyReservations(): Promise<Reservation[]> {
  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return [];

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .order("starts_at", { ascending: false });

  if (error || !data) return [];
  return data as Reservation[];
}
