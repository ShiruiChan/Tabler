import "server-only";

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types/database";

/**
 * Fetch an active tenant by slug using the server Supabase client.
 *
 * RLS already restricts the anon/authenticated role to status='active' rows,
 * but we also add an explicit filter for clarity and defence-in-depth.
 *
 * Returns null when no active tenant with that slug exists.
 *
 * NOTE: Pages that call this function must be dynamic (add
 * `export const dynamic = 'force-dynamic'` if Next.js would otherwise
 * statically pre-render them at build time, since createClient() calls
 * next/headers cookies() which requires a request context).
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (error || !data) return null;

  return data as Tenant;
}

/**
 * Like `getTenantBySlug` but calls Next.js `notFound()` when the tenant does
 * not exist or is not active.  Use in page/layout components to get automatic
 * 404 handling.
 */
export async function requireTenant(slug: string): Promise<Tenant> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  return tenant;
}

/**
 * Read the `x-tenant-slug` header set by the middleware on rewritten tenant
 * requests.  Returns null when not present (e.g. on platform/admin routes).
 *
 * Must be called inside a server context (Server Component, Route Handler,
 * Server Action) where next/headers is available.
 */
export function getTenantSlugFromHeaders(): string | null {
  const headerStore = headers();
  return headerStore.get("x-tenant-slug");
}
