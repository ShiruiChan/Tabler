import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { TenantModulePricing } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Module catalog constants
// ---------------------------------------------------------------------------

/**
 * Typed map of every module id defined in the platform catalog.
 * Use these keys everywhere in app code instead of raw strings to catch
 * typos at compile time.
 *
 * @example
 *   if (await tenantHasModule(tenantId, MODULES.events)) { ... }
 */
export const MODULES = {
  menu:          'menu',
  reservations:  'reservations',
  site_design:   'site_design',
  events:        'events',
  floor_plan:    'floor_plan',
  delivery:      'delivery',
  ordering:      'ordering',
  custom_domain: 'custom_domain',
} as const;

/** Union type of all valid module id strings. */
export type ModuleId = keyof typeof MODULES;

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of module ids that are currently enabled for a tenant.
 *
 * Uses the server Supabase client (anon key + user session cookie) so RLS
 * applies.  The column grant on tenant_modules limits the readable columns to
 * tenant_id, module_id, enabled, and enabled_at for anon/authenticated callers,
 * which is all we need here.
 *
 * Must be called inside a server context (Server Component, Route Handler,
 * or Server Action).
 */
export async function getEnabledModules(tenantId: string): Promise<string[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tenant_modules")
    .select("module_id")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);

  if (error || !data) return [];

  return data.map((row: { module_id: string }) => row.module_id);
}

/**
 * Returns true when a specific module is enabled for the given tenant.
 *
 * Delegates to `getEnabledModules` so both helpers share the same RLS path.
 * For repeated per-module checks within a single request, prefer calling
 * `getEnabledModules` once and checking the result array.
 */
export async function tenantHasModule(
  tenantId: string,
  moduleId: string,
): Promise<boolean> {
  const enabled = await getEnabledModules(tenantId);
  return enabled.includes(moduleId);
}

/**
 * Returns full pricing details for all active modules of a tenant.
 *
 * Calls the security-definer Postgres function `get_tenant_module_pricing`,
 * which authorises the caller (must be the tenant's owner/staff or a
 * super_admin) before returning pricing data including price_override_cents.
 *
 * Throws when the caller is not authorised (the DB function raises
 * insufficient_privilege).
 */
export async function getTenantModulePricing(
  tenantId: string,
): Promise<TenantModulePricing[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_tenant_module_pricing", {
    t: tenantId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []) as TenantModulePricing[];
}
