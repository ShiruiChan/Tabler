import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { Module, Tenant, TenantModulePricing } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// listTenants
// ---------------------------------------------------------------------------

/**
 * Returns every tenant row, regardless of status.
 *
 * Rationale: the public SELECT policy on `tenants` restricts plain authenticated
 * callers to `status = 'active'` rows only.  However, the super_admin ALL
 * policy (`using (public.is_super_admin())`) covers SELECT as well - Postgres
 * evaluates all matching policies for the operation with OR logic, so a
 * super_admin session satisfies the ALL policy and sees all rows including
 * suspended and pending ones.  No special view or RPC is required; a plain
 * select with no status filter is correct for super_admin callers.
 *
 * requireRole('super_admin') is called first to ensure the session is
 * authenticated as a super_admin before issuing the query.
 */
export async function listTenants(): Promise<Tenant[]> {
  await requireRole("super_admin");

  const supabase = createClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data as Tenant[];
}

// ---------------------------------------------------------------------------
// TenantWithModules - composite return type
// ---------------------------------------------------------------------------

export interface TenantWithModules {
  tenant: Tenant;
  /**
   * One entry per active module in the platform catalog.
   * Includes pricing data returned by get_tenant_module_pricing().
   * enabled=false rows are included so the UI can show all available modules.
   */
  modules: TenantModulePricing[];
}

// ---------------------------------------------------------------------------
// getTenantWithModules
// ---------------------------------------------------------------------------

/**
 * Returns the tenant row plus full module pricing data for the given tenantId.
 *
 * Module list: calls the security-definer RPC `get_tenant_module_pricing(t)`
 * which authorises super_admin callers (via `has_tenant_role`) and returns
 * one row per active module including price_override_cents.  This is the only
 * safe way to read price_override_cents - direct SELECT is denied by the
 * column grant on tenant_modules for all authenticated roles including
 * super_admin (see 0002_modules_pricing.sql section 8).
 *
 * Tenant row: fetched with a plain select.  The super_admin ALL policy covers
 * all statuses, matching the reasoning documented in listTenants().
 *
 * Returns null when the tenant does not exist (RLS or missing row).
 */
export async function getTenantWithModules(
  tenantId: string
): Promise<TenantWithModules | null> {
  await requireRole("super_admin");

  const supabase = createClient();

  // Fetch tenant row (super_admin sees all statuses via ALL policy).
  const { data: tenantData, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenantData) return null;

  // Fetch module pricing via security-definer RPC.
  // super_admin satisfies the has_tenant_role(t) check inside the function.
  const { data: pricingData, error: pricingError } = await supabase.rpc(
    "get_tenant_module_pricing",
    { t: tenantId }
  );

  if (pricingError) {
    // RPC raised insufficient_privilege or another error.
    // Return the tenant with an empty module list rather than crashing.
    return {
      tenant: tenantData as Tenant,
      modules: [],
    };
  }

  return {
    tenant: tenantData as Tenant,
    modules: (pricingData ?? []) as TenantModulePricing[],
  };
}

// ---------------------------------------------------------------------------
// listModules
// ---------------------------------------------------------------------------

/**
 * Returns all module catalog rows including inactive ones.
 *
 * The public SELECT policy restricts plain authenticated callers to
 * `is_active = true` rows only.  The super_admin ALL policy covers all rows
 * (same OR-logic reasoning as listTenants).  No status filter is applied so
 * the admin can see and manage inactive modules.
 */
export async function listModules(): Promise<Module[]> {
  await requireRole("super_admin");

  const supabase = createClient();

  const { data, error } = await supabase
    .from("modules")
    .select("*")
    .order("id", { ascending: true });

  if (error || !data) return [];

  return data as Module[];
}
