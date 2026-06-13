import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { Profile, UserRole } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

/**
 * Returns the currently authenticated Supabase user, or null if the request
 * is unauthenticated.  Always uses `getUser()` (not `getSession()`) so the
 * JWT is validated server-side rather than trusting the client cookie alone.
 */
export async function getSession(): Promise<User | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

/**
 * Returns the public.profiles row for the currently authenticated user, or
 * null if the request is unauthenticated or the profile does not exist yet.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

/**
 * Asserts that the request is authenticated and that the profile role matches
 * one of the allowed roles.
 *
 * - Unauthenticated → redirect to /login (preserving `next` param).
 * - Authenticated but wrong role → redirect to /.
 *
 * Call this at the top of a Server Component page to enforce access control.
 * Returns the profile when the check passes.
 */
export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    // We can't easily determine the current pathname in a server component
    // without the incoming request - callers may pass a `next` hint.
    // For now, redirect to /login without a next param.  Pages that need
    // the exact next URL should call redirect() themselves after requireRole.
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (error || !data) {
    redirect("/login");
  }

  const profile = data as Profile;

  if (!roles.includes(profile.role)) {
    redirect("/");
  }

  return profile;
}
