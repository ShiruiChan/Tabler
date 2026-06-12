import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import type { FloorPlan, FloorTable } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Public composite type
// ---------------------------------------------------------------------------

/** A floor plan together with all its tables. */
export interface FloorPlanWithTables extends FloorPlan {
  tables: FloorTable[];
}

// ---------------------------------------------------------------------------
// getPublicFloorPlans
// ---------------------------------------------------------------------------

/**
 * Returns the public-facing floor plans for a given tenant: only active plans
 * (whose owning tenant is active) together with ALL their tables (regardless
 * of is_bookable — non-bookable tables render as unavailable zones).
 *
 * This function issues two queries then groups tables into plans in JS to
 * avoid a nested Supabase query and keep type inference straightforward.
 *
 * Authorization: none — RLS public-read policies on floor_plans and
 * floor_tables enforce the is_active / tenant-active constraints.
 *
 * Returns an empty array when the tenant has no visible floor plan content.
 */
export async function getPublicFloorPlans(
  tenantId: string
): Promise<FloorPlanWithTables[]> {
  const supabase = createClient();

  // Fetch active plans for this tenant, ordered for display.
  const { data: plans, error: planError } = await supabase
    .from("floor_plans")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (planError || !plans || plans.length === 0) {
    return [];
  }

  // Collect plan IDs for the subsequent tables query.
  const planIds = (plans as FloorPlan[]).map((p) => p.id);

  // Fetch all tables belonging to those plans (RLS public policy allows this
  // because their parent plans are active and the tenant is active).
  const { data: tables, error: tableError } = await supabase
    .from("floor_tables")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("floor_plan_id", planIds);

  if (tableError) return [];

  const tableList = (tables ?? []) as FloorTable[];

  // Group tables by floor_plan_id.
  const tablesByPlan = new Map<string, FloorTable[]>();
  for (const table of tableList) {
    const bucket = tablesByPlan.get(table.floor_plan_id) ?? [];
    bucket.push(table);
    tablesByPlan.set(table.floor_plan_id, bucket);
  }

  return (plans as FloorPlan[]).map((plan) => ({
    ...plan,
    tables: tablesByPlan.get(plan.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// getFloorPlansForDashboard
// ---------------------------------------------------------------------------

/**
 * Returns the full set of floor plans for a given tenant — including inactive
 * plans and non-bookable tables — intended for the dashboard floor-plan editor.
 *
 * Authorization:
 *   - The caller must be signed in.
 *   - restaurant_owner / restaurant_staff: their profile.tenant_id must match
 *     the requested tenantId.
 *   - super_admin: may access any tenant's floor plans.
 *   All other callers receive an empty array.
 *
 * RLS policies further enforce these rules at the database layer, so even if
 * this application-level check were bypassed the database would return no rows.
 *
 * Returns an empty array when the caller is unauthorised or no floor plan
 * content exists.
 */
export async function getFloorPlansForDashboard(
  tenantId: string
): Promise<FloorPlanWithTables[]> {
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

  // Fetch ALL plans for this tenant (RLS: has_tenant_role allows this).
  const { data: plans, error: planError } = await supabase
    .from("floor_plans")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (planError || !plans || plans.length === 0) {
    return [];
  }

  const planIds = (plans as FloorPlan[]).map((p) => p.id);

  // Fetch ALL tables for this tenant (RLS: has_tenant_role allows this).
  const { data: tables, error: tableError } = await supabase
    .from("floor_tables")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("floor_plan_id", planIds);

  if (tableError) return [];

  const tableList = (tables ?? []) as FloorTable[];

  // Group tables by floor_plan_id.
  const tablesByPlan = new Map<string, FloorTable[]>();
  for (const table of tableList) {
    const bucket = tablesByPlan.get(table.floor_plan_id) ?? [];
    bucket.push(table);
    tablesByPlan.set(table.floor_plan_id, bucket);
  }

  return (plans as FloorPlan[]).map((plan) => ({
    ...plan,
    tables: tablesByPlan.get(plan.id) ?? [],
  }));
}
