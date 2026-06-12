import { createBrowserClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

/**
 * Browser (client-side) Supabase client.
 *
 * Creation is lazy: the client is only instantiated when first called.
 * `requireEnv` throws a clear error at runtime if the required vars are absent.
 * NEXT_PUBLIC_ vars are inlined by Next.js at build time, so the build itself
 * is safe; missing values will surface when a user actually opens the app.
 */
export function createClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
