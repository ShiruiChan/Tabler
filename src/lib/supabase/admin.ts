import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Supabase admin client using the service-role key.
 *
 * IMPORTANT: This module is server-only (the `import 'server-only'` guard above
 * will cause a build error if it is ever imported in a Client Component or the
 * browser bundle).
 *
 * Use this client exclusively in trusted server contexts (e.g. internal API
 * routes, background jobs, seed scripts). Never expose it to the client.
 *
 * `requireEnv` throws a clear error at runtime if the required vars are absent,
 * while remaining build-safe: `next build` never instantiates this client.
 */
export function createAdminClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
