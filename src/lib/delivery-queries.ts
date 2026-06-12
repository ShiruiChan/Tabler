import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import type { DeliverySettings, DeliveryZone } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shared staff-auth check used by all delivery query functions.
 * Returns the profile when the caller is restaurant_owner, restaurant_staff,
 * or super_admin; returns null otherwise.
 *
 * super_admin is allowed here because dashboard queries are read-only and RLS
 * handles visibility.
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
// getDeliverySettings
// ---------------------------------------------------------------------------

/**
 * Returns the delivery_settings singleton row for a tenant (auto-created by
 * trigger on tenant INSERT, so always exists).
 *
 * Authorization:
 *   - restaurant_owner / restaurant_staff: profile.tenant_id must match tenantId.
 *   - super_admin: may access any tenant.
 *   - All other callers receive null.
 *   RLS ("delivery_settings: tenant role read own") provides the database-layer
 *   backstop.
 *
 * @param tenantId UUID of the tenant.
 */
export async function getDeliverySettings(
  tenantId: string
): Promise<DeliverySettings | null> {
  const profile = await requireStaffOrAdmin();
  if (!profile) return null;

  if (
    profile.role !== "super_admin" &&
    profile.tenant_id !== tenantId
  ) {
    return null;
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("delivery_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) return null;
  return data as DeliverySettings;
}

// ---------------------------------------------------------------------------
// getDeliveryZones
// ---------------------------------------------------------------------------

/**
 * Returns ALL delivery zones (including inactive) for a tenant, ordered by
 * sort_order then name.
 * Intended for the B2B staff/owner dashboard.
 *
 * Authorization: same double-scope as getDeliverySettings.
 *
 * @param tenantId UUID of the tenant.
 */
export async function getDeliveryZones(
  tenantId: string
): Promise<DeliveryZone[]> {
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
    .from("delivery_zones")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as DeliveryZone[];
}
