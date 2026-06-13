import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/env";
import type { SiteSettings } from "@/lib/types/database";

/**
 * Fetch the site design settings for a tenant.
 *
 * Uses the server Supabase client so RLS governs visibility:
 *   - Public / anon callers receive settings for active tenants only.
 *   - Owner / staff can read their own tenant's settings regardless of status.
 *   - super_admin can read any row.
 *
 * Returns null when no row exists (e.g. the tenant is suspended and the
 * caller is anonymous) or when the tenantId is not found.
 *
 * Must be called inside a server context (Server Component, Route Handler,
 * or Server Action) where next/headers is available.
 */
export async function getSiteSettings(
  tenantId: string,
): Promise<SiteSettings | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("site_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) return null;

  return data as SiteSettings;
}

/**
 * Build the public CDN URL for a file stored in the tenant-assets bucket.
 *
 * The bucket is public so no signed URLs are needed - the Supabase Storage
 * CDN serves objects at a stable, predictable path.
 *
 * @param path - The object path inside the bucket, including the tenant folder
 *               prefix.  E.g. `"a1b2c3d4-.../logo.png"`.
 * @returns     A fully-qualified HTTPS URL.
 *
 * @example
 *   const logoUrl = getPublicAssetUrl(`${tenant.id}/logo.png`);
 */
export function getPublicAssetUrl(path: string): string {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  return `${url}/storage/v1/object/public/tenant-assets/${path}`;
}
