/**
 * env.ts
 *
 * Runtime environment variable assertion helpers.
 *
 * `requireEnv` is intentionally NOT called at module evaluation time — it must
 * only be called inside functions that run during an actual HTTP request (or
 * equivalent runtime context).  That way `next build` can complete without real
 * env vars, because static pre-render paths that never instantiate a Supabase
 * client will never execute the guard.
 */

/**
 * Returns the value of the named environment variable, or throws a clear error
 * if it is missing or empty.  Only call this inside functions, never at the
 * top level of a module.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Set it in .env.local (development) or your deployment environment (production).`
    );
  }
  return value;
}
