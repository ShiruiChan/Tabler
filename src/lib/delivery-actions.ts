"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared action state type
// ---------------------------------------------------------------------------

/** Returned by delivery server actions.  null = success. */
export type DeliveryActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// requireTenantStaff (local copy — follows event-actions.ts pattern)
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
 * Revalidates the B2B dashboard delivery path and the public B2C tenant
 * path so both views reflect the latest state after any write.
 */
async function revalidateDeliveryPaths(tenantId: string): Promise<void> {
  revalidatePath("/dashboard/delivery");

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/order`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Error mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps Postgres error codes (and delivery-trigger RAISE message substrings) to
 * user-friendly messages.
 *
 * Polygon validation trigger (validate_delivery_zone_polygon) uses plain
 * `raise exception` which produces error code P0001.  Exact RAISE messages
 * from 0008_delivery.sql:
 *
 *   "delivery_zone polygon must be a JSON array of [lng,lat] pairs, got %"
 *   "delivery_zone polygon must have at least 3 coordinate pairs, got %"
 *   "delivery_zone polygon point % must be a [lng,lat] array, got %"
 *   "delivery_zone polygon point % must have exactly 2 elements, got %"
 *   "delivery_zone polygon point %: longitude (index 0) must be a number, got %"
 *   "delivery_zone polygon point %: latitude (index 1) must be a number, got %"
 *
 * 23505 — unique constraint violation; the predictable constraint name
 *         delivery_zones_tenant_id_name_key is mapped to a friendly message.
 * 23514 — check constraint violation.
 */
function mapDbError(
  code: string | undefined,
  message: string | undefined,
  defaultMsg: string
): string {
  // Polygon trigger messages — P0001 with substring matches on exact RAISE text.
  if (code === "P0001") {
    if (message?.includes("delivery_zone polygon must be a JSON array")) {
      return "Polygon must be a JSON array of [lng,lat] pairs.";
    }
    if (message?.includes("delivery_zone polygon must have at least 3 coordinate pairs")) {
      return "Polygon must have at least 3 coordinate pairs.";
    }
    if (message?.includes("delivery_zone polygon point") && message?.includes("must be a [lng,lat] array")) {
      return "Each polygon point must be a [lng,lat] array.";
    }
    if (message?.includes("delivery_zone polygon point") && message?.includes("must have exactly 2 elements")) {
      return "Each polygon point must have exactly 2 elements (longitude and latitude).";
    }
    if (message?.includes("longitude (index 0) must be a number")) {
      return "Each polygon point's longitude must be a number.";
    }
    if (message?.includes("latitude (index 1) must be a number")) {
      return "Each polygon point's latitude must be a number.";
    }
  }
  if (code === "23505") {
    if (message?.includes("delivery_zones_tenant_id_name_key")) {
      return "A zone with that name already exists. Please choose a different name.";
    }
    return "A duplicate record already exists.";
  }
  if (code === "23514") {
    return "One or more values violated a database constraint. Please check your input.";
  }
  return defaultMsg;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** HH:MM time format regex for delivery schedule validation. */
const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Cents field from major-unit string input.
 * Accepts empty string → null (for nullable fields).
 */
function centsField(label: string, max: number) {
  return z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v))
    .pipe(
      z
        .string()
        .nullable()
        .transform((v) => {
          if (v === null) return null;
          const parsed = Math.round(parseFloat(v) * 100);
          return isNaN(parsed) ? null : parsed;
        })
        .pipe(
          z
            .number()
            .nullable()
            .refine(
              (v) => v === null || (v >= 0 && v <= max),
              { message: `${label} must be between 0 and ${max / 100}.` }
            )
        )
    );
}

/**
 * Required cents field (not nullable) from major-unit string input.
 */
function requiredCentsField(label: string, max: number) {
  return z
    .string()
    .transform((v) => {
      const parsed = Math.round(parseFloat(v) * 100);
      return isNaN(parsed) ? 0 : parsed;
    })
    .pipe(
      z
        .number()
        .int()
        .min(0, { message: `${label} must be 0 or greater.` })
        .max(max, { message: `${label} must be at most ${max / 100}.` })
    );
}

/**
 * Delivery settings write schema.
 * Mirrors every DB CHECK in 0008_delivery.sql field-by-field:
 *
 *   is_enabled:               boolean (checkbox hidden-field pattern)
 *   min_order_cents:          0–10,000,000 (10M); stored as cents, input in major units
 *   base_fee_cents:           0–1,000,000 (1M); stored as cents, input in major units
 *   free_delivery_over_cents: null OR 0–10,000,000; empty string → null
 *   currency:                 'usd'|'eur'|'gbp'|'rub'
 *   estimated_minutes:        null OR 5–480; empty string → null
 *   schedule_N_closed:        "true"|"false" checkbox for day N (0–6)
 *   schedule_N_open:          "HH:MM" for day N
 *   schedule_N_close:         "HH:MM" for day N
 */
const deliverySettingsWriteSchema = z.object({
  is_enabled: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on" || v === "1"),

  min_order_cents: requiredCentsField("Minimum order", 10_000_000),

  base_fee_cents: requiredCentsField("Base delivery fee", 1_000_000),

  free_delivery_over_cents: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v))
    .pipe(
      z
        .string()
        .nullable()
        .transform((v) => {
          if (v === null) return null;
          const parsed = Math.round(parseFloat(v) * 100);
          return isNaN(parsed) ? null : parsed;
        })
        .pipe(
          z
            .number()
            .nullable()
            .refine(
              (v) => v === null || (v >= 0 && v <= 10_000_000),
              { message: "Free delivery threshold must be between 0 and 100000." }
            )
        )
    ),

  currency: z.enum(["usd", "eur", "gbp", "rub"], {
    message: "Currency must be one of usd, eur, gbp, rub.",
  }),

  estimated_minutes: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v))
    .pipe(
      z
        .string()
        .nullable()
        .transform((v) => (v === null ? null : parseInt(v, 10)))
        .pipe(
          z
            .number()
            .nullable()
            .refine(
              (v) => v === null || (Number.isInteger(v) && v >= 5 && v <= 480),
              { message: "Estimated minutes must be between 5 and 480." }
            )
        )
    ),
});

/**
 * Delivery zone write schema.
 * Mirrors every DB CHECK in 0008_delivery.sql for delivery_zones:
 *
 *   name:                    1–80 characters (delivery_zones_name_length)
 *   fee_override_cents:      null OR 0–1,000,000 (delivery_zones_fee_override_range)
 *   min_order_override_cents: null OR 0–10,000,000 (delivery_zones_min_order_override_range)
 *   is_active:               boolean (checkbox hidden-field pattern)
 *   sort_order:              integer (default 0)
 *   polygon:                 optional JSON textarea; empty → null; validated ≥3 points, ≤200
 */
const deliveryZoneWriteSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Zone name is required." })
    .max(80, { message: "Zone name must be 80 characters or fewer." }),

  fee_override_cents: centsField("Fee override", 1_000_000),

  min_order_override_cents: centsField("Minimum order override", 10_000_000),

  is_active: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on" || v === "1"),

  sort_order: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? 0 : parseInt(v, 10)))
    .pipe(
      z
        .number()
        .int()
        .min(-2147483648)
        .max(2147483647)
    ),

  polygon_json: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? null : v.trim()))
    .pipe(
      z
        .string()
        .nullable()
        // Application-layer polygon validation (before hitting the DB trigger)
        // so users get friendly messages.
        .superRefine((v, ctx) => {
          if (v === null) return; // null is fine (no polygon)

          let parsed: unknown;
          try {
            parsed = JSON.parse(v);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Polygon must be valid JSON.",
            });
            return;
          }

          if (!Array.isArray(parsed)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Polygon must be a JSON array of [lng,lat] pairs.",
            });
            return;
          }

          if (parsed.length < 3) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Polygon must have at least 3 coordinate pairs (got ${parsed.length}).`,
            });
            return;
          }

          if (parsed.length > 200) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Polygon has too many points (max 200, got ${parsed.length}).`,
            });
            return;
          }

          for (let i = 0; i < parsed.length; i++) {
            const point = parsed[i];
            if (!Array.isArray(point) || point.length !== 2) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Polygon point ${i} must be a [lng,lat] array with exactly 2 elements.`,
              });
              return;
            }
            const [lng, lat] = point as unknown[];
            if (typeof lng !== "number" || !isFinite(lng)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Polygon point ${i}: longitude must be a finite number.`,
              });
              return;
            }
            if (typeof lat !== "number" || !isFinite(lat)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Polygon point ${i}: latitude must be a finite number.`,
              });
              return;
            }
          }
        })
        // After superRefine, transform valid string to parsed array or null.
        .transform((v) => {
          if (v === null) return null;
          try {
            return JSON.parse(v) as [number, number][];
          } catch {
            return null;
          }
        })
    ),
});

// ---------------------------------------------------------------------------
// Schedule assembly helper
// ---------------------------------------------------------------------------

/**
 * Assembles the jsonb schedule object from per-day FormData fields.
 *
 * Expected field names (for each day 0–6):
 *   schedule_{day}_closed: "true" if closed (checkbox hidden-field pattern)
 *   schedule_{day}_open:   "HH:MM" (UTC) — opening time
 *   schedule_{day}_close:  "HH:MM" (UTC) — closing time
 *
 * Validation:
 *   - open and close must match HH:MM regex
 *   - when not closed: open < close (UTC times compared lexicographically,
 *     which is correct for HH:MM strings)
 *
 * Missing keys are left out of the returned object; the DB and application
 * layer treat missing keys as closed days (per migration design note 3).
 *
 * All times are UTC per project convention (matching 0006 availability_rules).
 *
 * @returns The assembled schedule object, or { error } if validation fails.
 */
function assembleSchedule(
  formData: FormData
): { schedule: Record<string, { open: string; close: string; closed: boolean }> } | { error: string } {
  const schedule: Record<string, { open: string; close: string; closed: boolean }> = {};
  const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

  for (const day of DAYS) {
    const closedRaw = formData.get(`schedule_${day}_closed`) as string | null;
    const openRaw   = (formData.get(`schedule_${day}_open`) as string | null) ?? "";
    const closeRaw  = (formData.get(`schedule_${day}_close`) as string | null) ?? "";

    const closed = closedRaw === "true" || closedRaw === "on" || closedRaw === "1";

    // Validate HH:MM format when the field is provided and non-empty.
    if (openRaw && !HH_MM_REGEX.test(openRaw)) {
      const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      return { error: `${dayNames[day]} open time must be in HH:MM format (UTC).` };
    }
    if (closeRaw && !HH_MM_REGEX.test(closeRaw)) {
      const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      return { error: `${dayNames[day]} close time must be in HH:MM format (UTC).` };
    }

    // When not closed, both times are required and open must be before close.
    if (!closed) {
      if (!openRaw || !closeRaw) {
        // Missing times: treat this day as not yet configured — skip it.
        continue;
      }
      // Lexicographic comparison is correct for HH:MM strings (e.g. "09:00" < "22:00").
      if (openRaw >= closeRaw) {
        const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        return { error: `${dayNames[day]} open time must be earlier than close time (UTC).` };
      }
    }

    schedule[String(day)] = {
      open:   openRaw || "00:00",
      close:  closeRaw || "00:00",
      closed,
    };
  }

  return { schedule };
}

// ---------------------------------------------------------------------------
// updateDeliverySettings
// ---------------------------------------------------------------------------

/**
 * Server action: update the delivery_settings singleton row for the caller's tenant.
 *
 * 0-row decision: delivery_settings rows are always auto-created by the
 * handle_new_tenant_delivery_settings trigger, so an UPDATE with .eq("tenant_id")
 * should always find exactly 1 row.  On the edge case of a missing row (e.g.
 * backfill gap), we use upsert on tenant_id conflict so the row is created
 * transparently rather than silently succeeding with 0 rows affected.
 *
 * FormData fields:
 *   is_enabled (checkbox hidden-field pattern),
 *   min_order_cents (major-unit decimal), base_fee_cents (major-unit decimal),
 *   free_delivery_over_cents (major-unit decimal, optional → null),
 *   currency (usd|eur|gbp|rub),
 *   estimated_minutes (integer 5–480, optional → null),
 *   schedule_{0..6}_closed, schedule_{0..6}_open, schedule_{0..6}_close
 *
 * Returns null on success; { error } on failure.
 */
export async function updateDeliverySettings(
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    is_enabled:               formData.get("is_enabled")               as string ?? "",
    min_order_cents:          formData.get("min_order_cents")          as string ?? "0",
    base_fee_cents:           formData.get("base_fee_cents")           as string ?? "0",
    free_delivery_over_cents: formData.get("free_delivery_over_cents") as string ?? "",
    currency:                 formData.get("currency")                 as string ?? "usd",
    estimated_minutes:        formData.get("estimated_minutes")        as string ?? "",
  };

  const result = deliverySettingsWriteSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  // Assemble schedule from per-day form fields.
  const scheduleResult = assembleSchedule(formData);
  if ("error" in scheduleResult) {
    return { error: scheduleResult.error };
  }

  const {
    is_enabled,
    min_order_cents,
    base_fee_cents,
    free_delivery_over_cents,
    currency,
    estimated_minutes,
  } = result.data;

  const supabase = createClient();

  // Upsert on tenant_id conflict so the row is created if missing (edge case).
  // Normal path: the trigger auto-creates the row on tenant INSERT, so this
  // upsert will always update the existing row.
  const { error: dbError } = await supabase
    .from("delivery_settings")
    .upsert(
      {
        tenant_id:               profile.tenant_id!,
        is_enabled,
        min_order_cents,
        base_fee_cents,
        free_delivery_over_cents,
        currency,
        schedule:                scheduleResult.schedule,
        estimated_minutes,
      },
      { onConflict: "tenant_id" }
    );

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to update delivery settings. Please try again."
      ),
    };
  }

  await revalidateDeliveryPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// createDeliveryZone
// ---------------------------------------------------------------------------

/**
 * Server action: create a new delivery zone for the caller's tenant.
 *
 * polygon_json: optional textarea containing a JSON array of [lng,lat] pairs.
 * Application-layer validation (≥3 points, ≤200 points, finite numbers) runs
 * before the DB so users get friendly zod errors instead of raw P0001.
 * The DB trigger serves as a backstop for any cases that bypass the API.
 *
 * FormData fields:
 *   name, fee_override_cents?, min_order_override_cents?,
 *   is_active (checkbox hidden-field pattern), sort_order?, polygon_json?
 *
 * Returns null on success; { error } on failure.
 */
export async function createDeliveryZone(
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    name:                    formData.get("name")                    as string ?? "",
    fee_override_cents:      formData.get("fee_override_cents")      as string ?? "",
    min_order_override_cents: formData.get("min_order_override_cents") as string ?? "",
    is_active:               formData.get("is_active")               as string ?? "",
    sort_order:              formData.get("sort_order")              as string ?? "0",
    polygon_json:            formData.get("polygon_json")            as string ?? "",
  };

  const result = deliveryZoneWriteSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    name,
    fee_override_cents,
    min_order_override_cents,
    is_active,
    sort_order,
    polygon_json,
  } = result.data;

  const supabase = createClient();

  const { error: dbError } = await supabase.from("delivery_zones").insert({
    tenant_id:               profile.tenant_id!,
    name,
    polygon:                 polygon_json ?? null,
    fee_override_cents:      fee_override_cents ?? null,
    min_order_override_cents: min_order_override_cents ?? null,
    is_active,
    sort_order,
  });

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to create delivery zone. Please try again."
      ),
    };
  }

  await revalidateDeliveryPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateDeliveryZone
// ---------------------------------------------------------------------------

/**
 * Server action: update an existing delivery zone (staff/owner-facing).
 *
 * FormData fields: id (UUID) + all deliveryZoneWriteSchema fields.
 *
 * Returns null on success; { error } on failure.
 */
export async function updateDeliveryZone(
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const id = (formData.get("id") as string ?? "").trim();
  if (!id) {
    return { error: "Zone id is required." };
  }

  const raw = {
    name:                    formData.get("name")                    as string ?? "",
    fee_override_cents:      formData.get("fee_override_cents")      as string ?? "",
    min_order_override_cents: formData.get("min_order_override_cents") as string ?? "",
    is_active:               formData.get("is_active")               as string ?? "",
    sort_order:              formData.get("sort_order")              as string ?? "0",
    polygon_json:            formData.get("polygon_json")            as string ?? "",
  };

  const result = deliveryZoneWriteSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    name,
    fee_override_cents,
    min_order_override_cents,
    is_active,
    sort_order,
    polygon_json,
  } = result.data;

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("delivery_zones")
    .update({
      name,
      polygon:                 polygon_json ?? null,
      fee_override_cents:      fee_override_cents ?? null,
      min_order_override_cents: min_order_override_cents ?? null,
      is_active,
      sort_order,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id!); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to update delivery zone. Please try again."
      ),
    };
  }

  await revalidateDeliveryPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteDeliveryZone
// ---------------------------------------------------------------------------

/**
 * Server action: delete a delivery zone (staff/owner-facing).
 *
 * @param id UUID of the delivery zone to delete.
 */
export async function deleteDeliveryZone(id: string): Promise<DeliveryActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!id || typeof id !== "string") {
    return { error: "Invalid zone id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("delivery_zones")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id!); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to delete delivery zone. Please try again."
      ),
    };
  }

  await revalidateDeliveryPaths(profile.tenant_id!);
  return null;
}
