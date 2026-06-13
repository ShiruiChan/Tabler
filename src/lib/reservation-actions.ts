"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { getAvailabilitySlots } from "@/lib/reservation-queries";
import type { Profile, ReservationStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared action state type
// ---------------------------------------------------------------------------

/** Returned by reservation server actions.  null = success. */
export type ReservationActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// requireTenantStaff (local copy following floor-actions.ts pattern)
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated profile when the caller is a restaurant_owner or
 * restaurant_staff with a non-null tenant_id.
 *
 * Returns null for: unauthenticated requests, super_admin (no tenant_id),
 * visitor role, or owner/staff without a tenant association.
 */
async function requireTenantStaff(): Promise<Profile | null> {
  const profile = await getProfile();
  if (!profile) return null;
  if (
    profile.role !== "restaurant_owner" &&
    profile.role !== "restaurant_staff"
  ) {
    return null;
  }
  if (!profile.tenant_id) return null;
  return profile;
}

// ---------------------------------------------------------------------------
// Revalidation helper
// ---------------------------------------------------------------------------

/**
 * Revalidates the dashboard reservations path and the public tenant reservation
 * path so that both the B2B dashboard and the B2C booking pages reflect the
 * latest state.
 */
async function revalidateReservationPaths(tenantId: string): Promise<void> {
  revalidatePath("/dashboard/reservations");

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/reservations`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Error mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps Postgres error codes to user-friendly messages.
 *
 * 23P01 - exclusion constraint violation (double-booking guard).
 * 23505 - unique constraint violation (generic duplicate).
 */
function mapDbError(code: string | undefined, defaultMsg: string): string {
  if (code === "23P01") {
    return "That table was just booked for this time - pick another slot or table.";
  }
  if (code === "23505") {
    return "A duplicate reservation already exists for these details.";
  }
  return defaultMsg;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createReservationSchema = z.object({
  tenant_id: z.string().uuid({ message: "Invalid tenant id." }),
  floor_table_id: z
    .string()
    .uuid({ message: "Invalid table id." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  guest_name: z
    .string()
    .min(1, { message: "Guest name is required." })
    .max(120, { message: "Guest name must be 120 characters or fewer." }),
  guest_email: z
    .string()
    .email({ message: "Please enter a valid email address." })
    .max(254, { message: "Email must be 254 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  guest_phone: z
    .string()
    .min(5, { message: "Phone number must be at least 5 characters." })
    .max(40, { message: "Phone number must be 40 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  party_size: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1, { message: "Party size must be at least 1." })
        .max(100, { message: "Party size must be at most 100." })
    ),
  starts_at: z
    .string()
    .min(1, { message: "Reservation start time is required." }),
  notes: z
    .string()
    .max(1000, { message: "Notes must be 1000 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const cancelReservationSchema = z.object({
  id: z.string().uuid({ message: "Invalid reservation id." }),
});

const staffUpdateStatusSchema = z.object({
  id: z.string().uuid({ message: "Invalid reservation id." }),
  status: z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"], {
    message: "Invalid reservation status.",
  }),
});

// HH:MM time string used for opens_at / closes_at.
const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, { message: "Time must be in HH:MM format." });

const upsertAvailabilityRuleSchema = z.object({
  weekday: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(0, { message: "Weekday must be 0–6." })
        .max(6, { message: "Weekday must be 0–6." })
    ),
  opens_at: timeSchema,
  closes_at: timeSchema,
  slot_minutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .refine((v) => [15, 30, 60].includes(v), {
          message: "Slot minutes must be 15, 30, or 60.",
        })
    ),
  last_seating_minutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(0, { message: "Last seating must be 0–480 minutes." })
        .max(480, { message: "Last seating must be 0–480 minutes." })
    ),
  is_closed: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on" || v === "1"),
});

const updateReservationSettingsSchema = z.object({
  max_party_size: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1, { message: "Max party size must be 1–100." })
        .max(100, { message: "Max party size must be 1–100." })
    ),
  min_advance_minutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(0, { message: "Min advance minutes must be ≥ 0." })
    ),
  max_advance_days: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(0, { message: "Max advance days must be ≥ 0." })
    ),
  default_duration_minutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(15, { message: "Duration must be 15–480 minutes." })
        .max(480, { message: "Duration must be 15–480 minutes." })
    ),
});

// ---------------------------------------------------------------------------
// createReservation
// ---------------------------------------------------------------------------

/**
 * Server action: create a new reservation (visitor-facing).
 *
 * Supports both authenticated users and anonymous guests:
 *   - Authenticated: inserts via the user's session client (RLS visitor INSERT
 *     policy applies; user_id = auth.uid() is set on the row).
 *   - Anonymous guest: inserts via the service-role admin client (bypasses RLS;
 *     user_id is null).  The service-role path additionally verifies that the
 *     tenant is active at the application layer (since RLS is bypassed).
 *
 * In both paths the following server-side validations run first (defense in
 * depth - the DB exclusion constraint is the final concurrency lock):
 *   1. party_size ≤ reservation_settings.max_party_size.
 *   2. starts_at falls within an open slot for the date/party_size combination
 *      (re-runs getAvailabilitySlots to confirm the slot is still valid).
 *   3. If floor_table_id is provided: the table's capacity >= party_size and
 *      it appears in the slot's availableTableIds.
 *
 * FormData fields:
 *   tenant_id, floor_table_id?, guest_name, guest_email?, guest_phone?,
 *   party_size, starts_at (ISO-8601 UTC), notes?
 *
 * Returns null on success; { error } on failure.
 */
export async function createReservation(
  _prev: ReservationActionState,
  formData: FormData
): Promise<ReservationActionState> {
  // --- Parse & validate form data ---
  const rawFloorTableId = (
    formData.get("floor_table_id") as string | null
  )?.trim() ?? "";

  const raw = {
    tenant_id:      formData.get("tenant_id")   as string ?? "",
    floor_table_id: rawFloorTableId !== "" ? rawFloorTableId : "",
    guest_name:     formData.get("guest_name")  as string ?? "",
    guest_email:    formData.get("guest_email") as string ?? "",
    guest_phone:    formData.get("guest_phone") as string ?? "",
    party_size:     formData.get("party_size")  as string ?? "",
    starts_at:      formData.get("starts_at")   as string ?? "",
    notes:          formData.get("notes")       as string ?? "",
  };

  const result = createReservationSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    tenant_id,
    floor_table_id,
    guest_name,
    guest_email,
    guest_phone,
    party_size,
    starts_at,
    notes,
  } = result.data;

  // --- Parse starts_at and derive the calendar date ---
  const startsAtDate = new Date(starts_at);
  if (isNaN(startsAtDate.getTime())) {
    return { error: "Invalid reservation start time." };
  }

  // Calendar date in UTC (YYYY-MM-DD) for slot computation.
  const dateISO = startsAtDate.toISOString().slice(0, 10);

  // --- Load reservation_settings for party_size cap ---
  const supabase = createClient();

  const { data: settingsData, error: settingsError } = await supabase
    .from("reservation_settings")
    .select("*")
    .eq("tenant_id", tenant_id)
    .single();

  if (settingsError || !settingsData) {
    return { error: "Could not load reservation settings. Please try again." };
  }

  if (party_size > settingsData.max_party_size) {
    return {
      error: `Party size exceeds the maximum of ${settingsData.max_party_size} guests.`,
    };
  }

  // --- Re-validate availability server-side ---
  const slots = await getAvailabilitySlots(tenant_id, dateISO, party_size);

  const matchingSlot = slots.find(
    (s) => new Date(s.slot).getTime() === startsAtDate.getTime()
  );

  if (!matchingSlot) {
    return {
      error:
        "The selected time slot is no longer available. Please choose another slot.",
    };
  }

  if (!matchingSlot.anyTableFree) {
    return {
      error: "No tables are available for this slot. Please choose another time.",
    };
  }

  // If a specific table was requested, verify it is in the available set.
  if (floor_table_id) {
    if (!matchingSlot.availableTableIds.includes(floor_table_id)) {
      return {
        error:
          "That table was just booked for this time - pick another slot or table.",
      };
    }

    // Also verify table capacity (belt-and-suspenders - the slot query already
    // filters capacity >= partySize, but a specific table might be requested
    // that wasn't in the candidate list).
    const { data: tableData, error: tableError } = await supabase
      .from("floor_tables")
      .select("capacity")
      .eq("id", floor_table_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (tableError || !tableData) {
      return { error: "Selected table not found." };
    }

    if (tableData.capacity < party_size) {
      return {
        error: `Selected table capacity (${tableData.capacity}) is less than the party size (${party_size}).`,
      };
    }
  }

  // --- Compute ends_at ---
  const endsAtDate = new Date(
    startsAtDate.getTime() +
      settingsData.default_duration_minutes * 60_000
  );

  // --- Determine caller and insert strategy ---
  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData?.user ?? null;

  if (authUser) {
    // Authenticated path: insert via session client (RLS applies).
    const { error: dbError } = await supabase.from("reservations").insert({
      tenant_id,
      floor_table_id: floor_table_id ?? null,
      user_id:        authUser.id,
      guest_name,
      guest_email:    guest_email ?? null,
      guest_phone:    guest_phone ?? null,
      party_size,
      starts_at:      startsAtDate.toISOString(),
      ends_at:        endsAtDate.toISOString(),
      status:         "pending",
      notes:          notes ?? null,
    });

    if (dbError) {
      return {
        error: mapDbError(dbError.code, "Failed to create reservation. Please try again."),
      };
    }
  } else {
    // Anonymous guest path: use the service-role client (bypasses RLS).
    // Explicitly verify tenant is active since RLS is bypassed.
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("status")
      .eq("id", tenant_id)
      .single();

    if (tenantError || !tenantData) {
      return { error: "Tenant not found." };
    }

    if (tenantData.status !== "active") {
      return { error: "This restaurant is not currently accepting reservations." };
    }

    const adminClient = createAdminClient();

    const { error: dbError } = await adminClient.from("reservations").insert({
      tenant_id,
      floor_table_id: floor_table_id ?? null,
      user_id:        null,
      guest_name,
      guest_email:    guest_email ?? null,
      guest_phone:    guest_phone ?? null,
      party_size,
      starts_at:      startsAtDate.toISOString(),
      ends_at:        endsAtDate.toISOString(),
      status:         "pending",
      notes:          notes ?? null,
    });

    if (dbError) {
      return {
        error: mapDbError(dbError.code, "Failed to create reservation. Please try again."),
      };
    }
  }

  await revalidateReservationPaths(tenant_id);
  return null;
}

// ---------------------------------------------------------------------------
// cancelMyReservation
// ---------------------------------------------------------------------------

/**
 * Server action: cancel a reservation owned by the authenticated visitor.
 *
 * Uses the caller's session client so RLS (visitor cancel own policy) and the
 * guard_visitor_reservation_update trigger enforce:
 *   - Only the owner's rows are matched (user_id = auth.uid()).
 *   - Only pending/confirmed → cancelled transitions are permitted.
 *   - No other columns may change (trigger guard).
 *
 * @param id UUID of the reservation to cancel.
 */
export async function cancelMyReservation(
  id: string
): Promise<ReservationActionState> {
  if (!id || typeof id !== "string") {
    return { error: "Invalid reservation id." };
  }

  const parsed = cancelReservationSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  // Verify the caller is authenticated.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "You must be signed in to cancel a reservation." };
  }

  const { error: dbError } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("user_id", userData.user.id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    if (dbError.message?.includes("permission denied")) {
      return {
        error:
          "This reservation cannot be cancelled (it may already be cancelled or completed).",
      };
    }
    return { error: mapDbError(dbError.code, "Failed to cancel reservation. Please try again.") };
  }

  // Fetch tenant_id so we can revalidate the correct paths.
  const { data: resData } = await supabase
    .from("reservations")
    .select("tenant_id")
    .eq("id", parsed.data.id)
    .single();

  if (resData?.tenant_id) {
    await revalidateReservationPaths(resData.tenant_id);
  }

  return null;
}

// ---------------------------------------------------------------------------
// staffUpdateReservationStatus
// ---------------------------------------------------------------------------

/**
 * Server action: update the status of a reservation (staff/owner-facing).
 *
 * Uses the caller's session client double-scoped to their profile.tenant_id so
 * writes are always restricted to the caller's own tenant.  RLS
 * (tenant role update own policy) provides the database-layer backstop.
 *
 * Supports all valid ReservationStatus transitions (pending, confirmed,
 * cancelled, completed, no_show).  Re-confirming a previously cancelled
 * reservation may trigger a 23P01 exclusion violation if the slot has since
 * been booked by another party; this is mapped to a friendly error.
 *
 * FormData fields: id (UUID), status (ReservationStatus)
 */
export async function staffUpdateReservationStatus(
  _prev: ReservationActionState,
  formData: FormData
): Promise<ReservationActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    id:     formData.get("id")     as string ?? "",
    status: formData.get("status") as string ?? "",
  };

  const result = staffUpdateStatusSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("reservations")
    .update({ status: result.data.status as ReservationStatus })
    .eq("id", result.data.id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        "Failed to update reservation status. Please try again."
      ),
    };
  }

  await revalidateReservationPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// upsertAvailabilityRule
// ---------------------------------------------------------------------------

/**
 * Server action: create or update the availability_rules row for a specific
 * weekday for the caller's tenant (staff/owner-facing).
 *
 * Uses supabase .upsert with onConflict: "tenant_id,weekday" to atomically
 * insert-or-update, which avoids the 23505 unique-constraint violation while
 * still mapping it to a friendly message as a fallback.
 *
 * FormData fields:
 *   weekday (0-6), opens_at (HH:MM), closes_at (HH:MM),
 *   slot_minutes (15|30|60), last_seating_minutes (0-480), is_closed (checkbox)
 */
export async function upsertAvailabilityRule(
  _prev: ReservationActionState,
  formData: FormData
): Promise<ReservationActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    weekday:              formData.get("weekday")              as string ?? "",
    opens_at:             formData.get("opens_at")             as string ?? "",
    closes_at:            formData.get("closes_at")            as string ?? "",
    slot_minutes:         formData.get("slot_minutes")         as string ?? "",
    last_seating_minutes: formData.get("last_seating_minutes") as string ?? "",
    is_closed:            formData.get("is_closed")            as string ?? "",
  };

  const result = upsertAvailabilityRuleSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const { weekday, opens_at, closes_at, slot_minutes, last_seating_minutes, is_closed } = result.data;

  if (!is_closed && opens_at >= closes_at) {
    return { error: "Opens time must be earlier than closes time." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("availability_rules")
    .upsert(
      {
        tenant_id:            profile.tenant_id,
        weekday,
        opens_at,
        closes_at,
        slot_minutes,
        last_seating_minutes,
        is_closed,
      },
      { onConflict: "tenant_id,weekday" }
    );

  if (dbError) {
    if (dbError.code === "23505") {
      return { error: "Rule for this weekday already exists." };
    }
    return {
      error: mapDbError(
        dbError.code,
        "Failed to save availability rule. Please try again."
      ),
    };
  }

  await revalidateReservationPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateReservationSettings
// ---------------------------------------------------------------------------

/**
 * Server action: update the reservation_settings row for the caller's tenant
 * (staff/owner-facing).
 *
 * FormData fields:
 *   max_party_size (1-100), min_advance_minutes (≥0),
 *   max_advance_days (≥0), default_duration_minutes (15-480)
 */
export async function updateReservationSettings(
  _prev: ReservationActionState,
  formData: FormData
): Promise<ReservationActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    max_party_size:           formData.get("max_party_size")           as string ?? "",
    min_advance_minutes:      formData.get("min_advance_minutes")      as string ?? "",
    max_advance_days:         formData.get("max_advance_days")         as string ?? "",
    default_duration_minutes: formData.get("default_duration_minutes") as string ?? "",
  };

  const result = updateReservationSettingsSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("reservation_settings")
    .update(result.data)
    .eq("tenant_id", profile.tenant_id);

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        "Failed to save reservation settings. Please try again."
      ),
    };
  }

  await revalidateReservationPaths(profile.tenant_id!);
  return null;
}
