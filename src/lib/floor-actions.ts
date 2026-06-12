"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import type { Profile } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared action state type
// ---------------------------------------------------------------------------

export type FloorActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// requireTenantStaff (local copy — menu-actions keeps its own private copy)
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated profile when the caller is a restaurant_owner or
 * restaurant_staff with a non-null tenant_id.
 *
 * Returns null for: unauthenticated requests, super_admin (no tenant_id),
 * visitor role, or owner/staff without a tenant association.
 *
 * super_admin is intentionally excluded because floor actions double-scope
 * writes to profile.tenant_id; super_admin has no tenant_id and uses the
 * super_admin ALL RLS policy directly.
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
 * Revalidates both the dashboard floor path and the public tenant floor path.
 */
async function revalidateFloorPaths(tenantId: string): Promise<void> {
  revalidatePath("/dashboard/floor");

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/floor`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const floorPlanCreateSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Floor plan name must be at least 1 character." })
    .max(80, { message: "Floor plan name must be 80 characters or fewer." }),
  width: z
    .string()
    .optional()
    .transform((val) => (val == null || val === "" ? 1000 : parseInt(val, 10)))
    .pipe(
      z
        .number()
        .int()
        .min(100, { message: "Width must be at least 100." })
        .max(10000, { message: "Width must be at most 10000." })
    ),
  height: z
    .string()
    .optional()
    .transform((val) => (val == null || val === "" ? 700 : parseInt(val, 10)))
    .pipe(
      z
        .number()
        .int()
        .min(100, { message: "Height must be at least 100." })
        .max(10000, { message: "Height must be at most 10000." })
    ),
});

const floorPlanUpdateSchema = z.object({
  id: z.string().uuid({ message: "Invalid floor plan id." }),
  name: z
    .string()
    .min(1, { message: "Floor plan name must be at least 1 character." })
    .max(80, { message: "Floor plan name must be 80 characters or fewer." }),
  is_active: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  sort_order: z
    .string()
    .optional()
    .transform((val) => (val == null || val === "" ? 0 : parseInt(val, 10)))
    .pipe(z.number().int().finite()),
});

// ---------------------------------------------------------------------------
// TableZone zod schema — strict discriminated union with numeric bounds.
// Rejects extra keys by using z.object (strict is not needed because the
// shape is discriminated and only the matching branch is checked; unknown
// keys on a non-strict z.object are stripped by default in Zod v4).
// ---------------------------------------------------------------------------

const rectZoneSchema = z.object({
  type: z.literal("rect"),
  x:    z.number().finite().min(0,  { message: "rect.x must be >= 0." }).max(10000, { message: "rect.x must be <= 10000." }),
  y:    z.number().finite().min(0,  { message: "rect.y must be >= 0." }).max(10000, { message: "rect.y must be <= 10000." }),
  w:    z.number().finite().min(10, { message: "rect.w must be >= 10." }).max(10000, { message: "rect.w must be <= 10000." }),
  h:    z.number().finite().min(10, { message: "rect.h must be >= 10." }).max(10000, { message: "rect.h must be <= 10000." }),
});

const circleZoneSchema = z.object({
  type: z.literal("circle"),
  cx:   z.number().finite().min(0, { message: "circle.cx must be >= 0." }).max(10000, { message: "circle.cx must be <= 10000." }),
  cy:   z.number().finite().min(0, { message: "circle.cy must be >= 0." }).max(10000, { message: "circle.cy must be <= 10000." }),
  r:    z.number().finite().min(5, { message: "circle.r must be >= 5."  }).max(10000, { message: "circle.r must be <= 10000." }),
});

/**
 * Strict discriminated-union zone validator.
 *
 * The input is a parsed JSON object.  After validation only the fields
 * required by the matched branch are kept (Zod strips unknown keys by default
 * on z.object, so extra keys are silently removed).
 */
const tableZoneSchema = z.discriminatedUnion("type", [
  rectZoneSchema,
  circleZoneSchema,
]);

const tableUpsertSchema = z.object({
  id:           z.string().uuid().optional(), // present on update, absent on insert
  floor_plan_id: z.string().uuid({ message: "Invalid floor plan id." }),
  label: z
    .string()
    .min(1, { message: "Label must be at least 1 character." })
    .max(20, { message: "Label must be 20 characters or fewer." }),
  capacity: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1,  { message: "Capacity must be at least 1." })
        .max(50, { message: "Capacity must be at most 50." })
    ),
  is_bookable: z
    .string()
    .optional()
    .transform((val) => val !== "false"),
  // zone is submitted as a JSON string; parsed and validated below.
  zone: z.string().min(1, { message: "Zone is required." }),
});

// ---------------------------------------------------------------------------
// createFloorPlan
// ---------------------------------------------------------------------------

/**
 * Server action: create a new floor plan for the authenticated staff/owner's
 * tenant.
 *
 * FormData fields: name, width?, height?
 */
export async function createFloorPlan(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    name:   formData.get("name")   as string ?? "",
    width:  formData.get("width")  as string ?? "",
    height: formData.get("height") as string ?? "",
  };

  const result = floorPlanCreateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase.from("floor_plans").insert({
    tenant_id:  profile.tenant_id,
    name:       result.data.name,
    width:      result.data.width,
    height:     result.data.height,
  });

  if (dbError) {
    return { error: "Failed to create floor plan. Please try again." };
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateFloorPlan
// ---------------------------------------------------------------------------

/**
 * Server action: update an existing floor plan's display fields.
 *
 * FormData fields: id, name, is_active?, sort_order?
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function updateFloorPlan(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    id:         formData.get("id")         as string ?? "",
    name:       formData.get("name")       as string ?? "",
    is_active:  formData.get("is_active")  as string ?? "true",
    sort_order: formData.get("sort_order") as string ?? "",
  };

  const result = floorPlanUpdateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("floor_plans")
    .update({
      name:       result.data.name,
      is_active:  result.data.is_active,
      sort_order: result.data.sort_order,
    })
    .eq("id", result.data.id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to update floor plan. Please try again." };
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteFloorPlan
// ---------------------------------------------------------------------------

/**
 * Server action: delete a floor plan.
 *
 * CAUTION: cascades — all floor_tables belonging to this plan are also deleted
 * (defined by the ON DELETE CASCADE constraint on floor_tables.floor_plan_id).
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function deleteFloorPlan(id: string): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!id || typeof id !== "string") {
    return { error: "Invalid floor plan id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("floor_plans")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to delete floor plan. Please try again." };
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// saveFloorPlanImage
// ---------------------------------------------------------------------------

/**
 * Server action: persist a freshly uploaded background image URL into the
 * floor_plans row.
 *
 * Validates that:
 *   - url uses https://
 *   - url originates from this project's Supabase storage (tenant-assets bucket)
 *   - the first path segment after the storage prefix equals the caller's
 *     tenant_id (parsed via new URL().pathname to avoid substring-match spoofing)
 *
 * The actual file upload is performed client-side directly to Supabase Storage.
 * This action only records the resulting public URL.
 *
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function saveFloorPlanImage(
  planId: string,
  url: string
): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!planId || typeof planId !== "string") {
    return { error: "Invalid floor plan id." };
  }

  // --- Validate URL: must be https ---
  if (!url.startsWith("https://")) {
    return { error: "Image URL must use the https:// protocol." };
  }

  // --- Validate URL: must originate from this project's Supabase storage ---
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const storagePrefix = `${supabaseUrl}/storage/v1/object/public/tenant-assets/`;
  if (!url.startsWith(storagePrefix)) {
    return {
      error: "Image URL must point to this project's tenant-assets storage.",
    };
  }

  // --- Validate ownership: parse the pathname and check the first folder ---
  // e.g. /storage/v1/object/public/tenant-assets/{tenant_id}/floor-plans/photo.jpg
  let parsedPathname: string;
  try {
    parsedPathname = new URL(url).pathname;
  } catch {
    return { error: "Image URL is not a valid URL." };
  }

  // The pathname looks like:
  //   /storage/v1/object/public/tenant-assets/<tenant_id>/...
  // Split on "/" and find the segment after "tenant-assets".
  const segments = parsedPathname.split("/").filter(Boolean);
  // segments: ["storage","v1","object","public","tenant-assets","<tenant_id>",...]
  const bucketIndex = segments.indexOf("tenant-assets");
  const firstFolder = bucketIndex !== -1 ? segments[bucketIndex + 1] : undefined;

  if (firstFolder !== profile.tenant_id) {
    return { error: "Image URL does not belong to your tenant folder." };
  }

  // --- Write to database ---
  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("floor_plans")
    .update({ image_url: url })
    .eq("id", planId)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to save image URL. Please try again." };
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// upsertTable
// ---------------------------------------------------------------------------

/**
 * Server action: create or update a floor table.
 *
 * When formData contains a non-empty "id" field the row is updated (UPDATE);
 * otherwise a new row is inserted (INSERT).
 *
 * FormData fields:
 *   id?            (UUID — present for update)
 *   floor_plan_id  (UUID)
 *   label          (1–20 characters)
 *   capacity       (integer 1–50)
 *   is_bookable?   ("false" to disable; anything else → true)
 *   zone           (JSON string: {"type":"rect","x":..} or {"type":"circle","cx":..})
 *
 * Zone validation:
 *   - Parsed from JSON string; must be a valid object.
 *   - Discriminated by "type" field: only "rect" and "circle" accepted.
 *   - Numeric bounds: rect x,y ≥ 0; w,h ≥ 10; circle cx,cy ≥ 0; r ≥ 5;
 *     all numeric values ≤ 10000.
 *   - Extra keys stripped (Zod default).
 *
 * Cross-tenant check:
 *   The floor_plan_id must belong to the caller's tenant.  This is checked at
 *   the application layer (query) AND enforced at the DB layer
 *   (check_table_plan_tenant trigger).
 *
 * All writes are double-scoped: tenant_id eq + RLS.
 */
export async function upsertTable(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const rawId = (formData.get("id") as string | null)?.trim() ?? "";

  const raw = {
    id:            rawId !== "" ? rawId : undefined,
    floor_plan_id: formData.get("floor_plan_id") as string ?? "",
    label:         formData.get("label")         as string ?? "",
    capacity:      formData.get("capacity")      as string ?? "",
    is_bookable:   formData.get("is_bookable")   as string ?? "true",
    zone:          formData.get("zone")           as string ?? "",
  };

  const result = tableUpsertSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  // --- Parse and validate zone ---
  let parsedZoneRaw: unknown;
  try {
    parsedZoneRaw = JSON.parse(result.data.zone);
  } catch {
    return { error: "Zone must be a valid JSON string." };
  }

  // Run the parsed JSON value through the strict zod discriminated-union schema.
  const zoneResult = tableZoneSchema.safeParse(parsedZoneRaw);
  if (!zoneResult.success) {
    return {
      error:
        zoneResult.error.issues[0]?.message ??
        "Zone must be a valid rect or circle descriptor.",
    };
  }

  const zone = zoneResult.data; // extra keys stripped by Zod

  // --- Verify floor_plan_id belongs to the caller's tenant ---
  const supabase = createClient();

  const { data: planRow, error: planError } = await supabase
    .from("floor_plans")
    .select("id, width, height")
    .eq("id", result.data.floor_plan_id)
    .eq("tenant_id", profile.tenant_id) // cross-tenant check at app layer
    .single();

  if (planError || !planRow) {
    return {
      error:
        "Floor plan not found or does not belong to your tenant.",
    };
  }

  // --- Validate zone fits within the plan canvas ---
  const { width: planWidth, height: planHeight } = planRow;
  let zoneOutOfBounds = false;
  if (zone.type === "rect") {
    zoneOutOfBounds = zone.x + zone.w > planWidth || zone.y + zone.h > planHeight;
  } else {
    zoneOutOfBounds =
      zone.cx - zone.r < 0 ||
      zone.cy - zone.r < 0 ||
      zone.cx + zone.r > planWidth ||
      zone.cy + zone.r > planHeight;
  }
  if (zoneOutOfBounds) {
    return {
      error: `Table zone extends outside the floor plan bounds (${planWidth}x${planHeight}).`,
    };
  }

  const payload = {
    tenant_id:     profile.tenant_id,
    floor_plan_id: result.data.floor_plan_id,
    label:         result.data.label,
    capacity:      result.data.capacity,
    is_bookable:   result.data.is_bookable,
    zone,
  };

  if (result.data.id) {
    // UPDATE — double-scoped: id + tenant_id + RLS
    const { error: dbError } = await supabase
      .from("floor_tables")
      .update(payload)
      .eq("id", result.data.id)
      .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

    if (dbError) {
      if (
        dbError.code === "23505" &&
        (dbError.message?.includes("floor_tables_plan_label_unique") ||
          dbError.message?.includes("label"))
      ) {
        return { error: "A table with that label already exists in this floor plan." };
      }
      return { error: "Failed to update table. Please try again." };
    }
  } else {
    // INSERT
    const { error: dbError } = await supabase
      .from("floor_tables")
      .insert(payload);

    if (dbError) {
      if (
        dbError.code === "23505" &&
        (dbError.message?.includes("floor_tables_plan_label_unique") ||
          dbError.message?.includes("label"))
      ) {
        return { error: "A table with that label already exists in this floor plan." };
      }
      return { error: "Failed to create table. Please try again." };
    }
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteTable
// ---------------------------------------------------------------------------

/**
 * Server action: delete a floor table.
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function deleteTable(id: string): Promise<FloorActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!id || typeof id !== "string") {
    return { error: "Invalid table id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("floor_tables")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to delete table. Please try again." };
  }

  await revalidateFloorPaths(profile.tenant_id!);
  return null;
}
