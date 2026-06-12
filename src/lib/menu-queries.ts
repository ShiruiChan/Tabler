import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import type { Dish, MenuCategory } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Public composite type
// ---------------------------------------------------------------------------

/** A menu category together with its available (public) or all (dashboard) dishes. */
export interface MenuCategoryWithDishes extends MenuCategory {
  dishes: Dish[];
}

// ---------------------------------------------------------------------------
// getPublicMenu
// ---------------------------------------------------------------------------

/**
 * Returns the public-facing menu for a given tenant: only active categories
 * (whose owning tenant is active) and only available dishes within them,
 * both sorted by sort_order ascending.
 *
 * This function issues two queries then groups dishes into categories in JS
 * to avoid a nested Supabase query and keep type inference straightforward.
 *
 * Authorization: none — RLS public-read policies on menu_categories and dishes
 * enforce the is_active / is_available / tenant-active constraints.
 *
 * Returns an empty array when the tenant has no visible menu content.
 */
export async function getPublicMenu(
  tenantId: string
): Promise<MenuCategoryWithDishes[]> {
  const supabase = createClient();

  // Fetch active categories for this tenant, ordered for display.
  const { data: categories, error: catError } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (catError || !categories || categories.length === 0) {
    return [];
  }

  // Fetch available dishes for this tenant, ordered for display.
  const { data: dishes, error: dishError } = await supabase
    .from("dishes")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (dishError) return [];

  const dishList = (dishes ?? []) as Dish[];

  // Group dishes by category_id.
  const dishesByCategory = new Map<string, Dish[]>();
  for (const dish of dishList) {
    const bucket = dishesByCategory.get(dish.category_id) ?? [];
    bucket.push(dish);
    dishesByCategory.set(dish.category_id, bucket);
  }

  return (categories as MenuCategory[]).map((cat) => ({
    ...cat,
    dishes: dishesByCategory.get(cat.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// getFullMenu
// ---------------------------------------------------------------------------

/**
 * Returns the full menu for a given tenant including inactive categories and
 * unavailable dishes — intended for the dashboard menu editor.
 *
 * Authorization:
 *   - The caller must be signed in.
 *   - restaurant_owner / restaurant_staff: their profile.tenant_id must match
 *     the requested tenantId.
 *   - super_admin: may access any tenant's menu.
 *   All other callers receive an empty array.
 *
 * RLS policies further enforce these rules at the database layer, so even if
 * this application-level check were bypassed the database would return no rows.
 *
 * Returns an empty array when the caller is unauthorised or no menu content
 * exists.
 */
export async function getFullMenu(
  tenantId: string
): Promise<MenuCategoryWithDishes[]> {
  const profile = await getProfile();
  if (!profile) return [];

  // Authorization check: super_admin can access any tenant; owner/staff only
  // their own tenant.
  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return [];
  }

  // restaurant_owner and restaurant_staff must have a tenant_id set.
  if (
    (profile.role === "restaurant_owner" ||
      profile.role === "restaurant_staff") &&
    !profile.tenant_id
  ) {
    return [];
  }

  const supabase = createClient();

  // Fetch ALL categories for this tenant (RLS: has_tenant_role allows this).
  const { data: categories, error: catError } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (catError || !categories || categories.length === 0) {
    return [];
  }

  // Fetch ALL dishes for this tenant (RLS: has_tenant_role allows this).
  const { data: dishes, error: dishError } = await supabase
    .from("dishes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (dishError) return [];

  const dishList = (dishes ?? []) as Dish[];

  // Group dishes by category_id.
  const dishesByCategory = new Map<string, Dish[]>();
  for (const dish of dishList) {
    const bucket = dishesByCategory.get(dish.category_id) ?? [];
    bucket.push(dish);
    dishesByCategory.set(dish.category_id, bucket);
  }

  return (categories as MenuCategory[]).map((cat) => ({
    ...cat,
    dishes: dishesByCategory.get(cat.id) ?? [],
  }));
}
