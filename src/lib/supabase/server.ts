import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

/**
 * Server-side Supabase client (Server Components, Route Handlers, Server Actions).
 *
 * Must be called inside a request context so that next/headers cookies() works.
 *
 * Creation is lazy per-request. `requireEnv` will throw clearly at runtime if
 * NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set, while
 * remaining build-safe because `next build` never instantiates this client.
 *
 * If a page performs static pre-rendering that calls this function, mark it
 * with `export const dynamic = 'force-dynamic'` so it only runs at request
 * time in a real runtime environment.
 */
export function createClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll is called from a Server Component - cookies cannot be
          // mutated here (only in middleware / Route Handlers). This is safe
          // to ignore; session refresh is handled by middleware.
        }
      },
    },
  });
}
