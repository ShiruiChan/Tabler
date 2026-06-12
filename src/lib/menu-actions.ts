"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import { ALLERGENS } from "@/lib/types/database";
import type { Profile } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared action state type (mirrors DashboardActionState in dashboard-actions.ts)
// ---------------------------------------------------------------------------

export type MenuActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// requireTenantStaff
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated profile when the caller is a restaurant_owner or
 * restaurant_staff with a non-null tenant_id.
 *
 * Returns null (and the caller should return { error }) for:
 *   - unauthenticated requests
 *   - super_admin (use direct DB access with admin client instead)
 *   - visitor role
 *   - owner/staff without a tenant association
 *
 * super_admin is intentionally excluded here because menu actions double-scope
 * writes to profile.tenant_id; super_admin has no tenant_id and uses the
 * super_admin ALL RLS policy directly.  If you need to expose these actions to
 * super_admin, add a separate admin-side action.
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
 * Revalidates both the dashboard menu path and the public tenant menu path.
 * Fetches the tenant slug once so we can build the correct public path.
 */
async function revalidateMenuPaths(tenantId: string): Promise<void> {
  revalidatePath("/dashboard/menu");

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/menu`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const categoryCreateSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Category name must be at least 1 character." })
    .max(80, { message: "Category name must be 80 characters or fewer." }),
  description: z
    .string()
    .max(500, { message: "Description must be 500 characters or fewer." })
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  sort_order: z
    .string()
    .optional()
    .transform((val) => (val == null || val === "" ? 0 : parseInt(val, 10)))
    .pipe(z.number().int().finite()),
});

const categoryUpdateSchema = categoryCreateSchema.extend({
  id: z.string().uuid({ message: "Invalid category id." }),
  is_active: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

// ---------------------------------------------------------------------------
// Dish price helper — parses a dollar-amount string into integer cents.
// Returns NaN on invalid input so the caller can reject.
// ---------------------------------------------------------------------------
function dollarsToCents(value: string | null | undefined): number {
  if (value == null || value === "") return NaN;
  const n = parseFloat(value);
  if (!isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

const dishCreateSchema = z.object({
  category_id: z.string().uuid({ message: "Invalid category id." }),
  name: z
    .string()
    .min(1, { message: "Dish name must be at least 1 character." })
    .max(120, { message: "Dish name must be 120 characters or fewer." }),
  description: z
    .string()
    .max(1000, { message: "Description must be 1000 characters or fewer." })
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  // price: validated separately via dollarsToCents (not in Zod schema to give
  // a clear error message before any other field validation)
  is_available: z
    .string()
    .optional()
    .transform((val) => val !== "false"),
  sort_order: z
    .string()
    .optional()
    .transform((val) => (val == null || val === "" ? 0 : parseInt(val, 10)))
    .pipe(z.number().int().finite()),
});

const dishUpdateSchema = dishCreateSchema.extend({
  id: z.string().uuid({ message: "Invalid dish id." }),
});

// ---------------------------------------------------------------------------
// createCategory
// ---------------------------------------------------------------------------

/**
 * Server action: create a new menu category for the authenticated staff/owner's
 * tenant.
 *
 * FormData fields: name, description?, sort_order?
 */
export async function createCategory(
  _prev: MenuActionState,
  formData: FormData
): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  const raw = {
    name: formData.get("name") as string ?? "",
    description: formData.get("description") as string ?? "",
    sort_order: formData.get("sort_order") as string ?? "",
  };

  const result = categoryCreateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("menu_categories")
    .insert({
      tenant_id: profile.tenant_id,
      name: result.data.name,
      description: result.data.description ?? null,
      sort_order: result.data.sort_order,
    });

  if (dbError) {
    return { error: "Failed to create category. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateCategory
// ---------------------------------------------------------------------------

/**
 * Server action: update an existing menu category.
 *
 * FormData fields: id, name, description?, sort_order?, is_active?
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function updateCategory(
  _prev: MenuActionState,
  formData: FormData
): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  const raw = {
    id: formData.get("id") as string ?? "",
    name: formData.get("name") as string ?? "",
    description: formData.get("description") as string ?? "",
    sort_order: formData.get("sort_order") as string ?? "",
    is_active: formData.get("is_active") as string ?? "true",
  };

  const result = categoryUpdateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("menu_categories")
    .update({
      name: result.data.name,
      description: result.data.description ?? null,
      sort_order: result.data.sort_order,
      is_active: result.data.is_active,
    })
    .eq("id", result.data.id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to update category. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteCategory
// ---------------------------------------------------------------------------

/**
 * Server action: delete a menu category.
 *
 * CAUTION: cascades — all dishes belonging to this category are also deleted
 * (defined by the ON DELETE CASCADE constraint on dishes.category_id).
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function deleteCategory(id: string): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  if (!id || typeof id !== "string") {
    return { error: "Invalid category id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("menu_categories")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to delete category. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// createDish
// ---------------------------------------------------------------------------

/**
 * Server action: create a new dish in the authenticated staff/owner's tenant.
 *
 * FormData fields:
 *   category_id (UUID), name, description?, price (dollar amount string),
 *   allergens (multi-value; only ALLERGENS values are accepted),
 *   is_available?, sort_order?
 *
 * Price is accepted as a decimal dollar amount (e.g. "12.50") and converted to
 * integer cents.  Negative values and NaN are rejected.
 * Allergens are filtered to the ALLERGENS allowlist before persisting.
 */
export async function createDish(
  _prev: MenuActionState,
  formData: FormData
): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  // Validate price separately for a clearer error message.
  const priceRaw = formData.get("price") as string | null;
  const priceCents = dollarsToCents(priceRaw);
  if (!isFinite(priceCents) || priceCents < 0) {
    return { error: "Price must be a non-negative number (e.g. 12.50)." };
  }

  const raw = {
    category_id: formData.get("category_id") as string ?? "",
    name: formData.get("name") as string ?? "",
    description: formData.get("description") as string ?? "",
    is_available: formData.get("is_available") as string ?? "true",
    sort_order: formData.get("sort_order") as string ?? "",
  };

  const result = dishCreateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  // Filter allergens to the allowlist; unknown values are silently dropped.
  const rawAllergens = formData.getAll("allergens") as string[];
  const allergens = rawAllergens.filter((a): a is typeof ALLERGENS[number] =>
    (ALLERGENS as readonly string[]).includes(a)
  );

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("dishes")
    .insert({
      tenant_id: profile.tenant_id,
      category_id: result.data.category_id,
      name: result.data.name,
      description: result.data.description ?? null,
      price_cents: priceCents,
      allergens,
      is_available: result.data.is_available,
      sort_order: result.data.sort_order,
    });

  if (dbError) {
    return { error: "Failed to create dish. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateDish
// ---------------------------------------------------------------------------

/**
 * Server action: update an existing dish.
 *
 * FormData fields: id (UUID) + same fields as createDish.
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function updateDish(
  _prev: MenuActionState,
  formData: FormData
): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  const priceRaw = formData.get("price") as string | null;
  const priceCents = dollarsToCents(priceRaw);
  if (!isFinite(priceCents) || priceCents < 0) {
    return { error: "Price must be a non-negative number (e.g. 12.50)." };
  }

  const raw = {
    id: formData.get("id") as string ?? "",
    category_id: formData.get("category_id") as string ?? "",
    name: formData.get("name") as string ?? "",
    description: formData.get("description") as string ?? "",
    is_available: formData.get("is_available") as string ?? "true",
    sort_order: formData.get("sort_order") as string ?? "",
  };

  const result = dishUpdateSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const rawAllergens = formData.getAll("allergens") as string[];
  const allergens = rawAllergens.filter((a): a is typeof ALLERGENS[number] =>
    (ALLERGENS as readonly string[]).includes(a)
  );

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("dishes")
    .update({
      category_id: result.data.category_id,
      name: result.data.name,
      description: result.data.description ?? null,
      price_cents: priceCents,
      allergens,
      is_available: result.data.is_available,
      sort_order: result.data.sort_order,
    })
    .eq("id", result.data.id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to update dish. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteDish
// ---------------------------------------------------------------------------

/**
 * Server action: delete a dish.
 * The write is double-scoped: tenant_id eq + RLS.
 */
export async function deleteDish(id: string): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  if (!id || typeof id !== "string") {
    return { error: "Invalid dish id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("dishes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to delete dish. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// saveDishPhoto
// ---------------------------------------------------------------------------

/**
 * Server action: persist a freshly uploaded dish photo URL into the dishes row.
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
export async function saveDishPhoto(
  dishId: string,
  url: string
): Promise<MenuActionState> {
  const profile = await requireTenantStaff();
  if (!profile) return { error: "You must be signed in as restaurant staff or owner." };

  if (!dishId || typeof dishId !== "string") {
    return { error: "Invalid dish id." };
  }

  // --- Validate URL: must be https ---
  if (!url.startsWith("https://")) {
    return { error: "Photo URL must use the https:// protocol." };
  }

  // --- Validate URL: must originate from this project's Supabase storage ---
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const storagePrefix = `${supabaseUrl}/storage/v1/object/public/tenant-assets/`;
  if (!url.startsWith(storagePrefix)) {
    return {
      error: "Photo URL must point to this project's tenant-assets storage.",
    };
  }

  // --- Validate ownership: parse the pathname and check the first folder ---
  // e.g. /storage/v1/object/public/tenant-assets/{tenant_id}/dishes/photo.jpg
  // After stripping the fixed prefix the remaining path starts with tenant_id.
  let parsedPathname: string;
  try {
    parsedPathname = new URL(url).pathname;
  } catch {
    return { error: "Photo URL is not a valid URL." };
  }

  // The pathname looks like:
  //   /storage/v1/object/public/tenant-assets/<tenant_id>/...
  // Split on "/" and find the segment after "tenant-assets".
  const segments = parsedPathname.split("/").filter(Boolean);
  // segments: ["storage","v1","object","public","tenant-assets","<tenant_id>",...]
  const bucketIndex = segments.indexOf("tenant-assets");
  const firstFolder = bucketIndex !== -1 ? segments[bucketIndex + 1] : undefined;

  if (firstFolder !== profile.tenant_id) {
    return { error: "Photo URL does not belong to your tenant folder." };
  }

  // --- Write to database ---
  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("dishes")
    .update({ photo_url: url })
    .eq("id", dishId)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to save photo URL. Please try again." };
  }

  await revalidateMenuPaths(profile.tenant_id!);
  return null;
}
