"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AuthActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// Validation schemas (zod v4)
// ---------------------------------------------------------------------------

const signInSchema = z.object({
  email: z.email({ message: "Invalid email address." }),
  password: z.string().min(1, { message: "Password is required." }),
});

const signUpSchema = z.object({
  email: z.email({ message: "Invalid email address." }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters." }),
  full_name: z
    .string()
    .min(1, { message: "Full name is required." })
    .max(120, { message: "Full name is too long." }),
});

// ---------------------------------------------------------------------------
// signIn
// ---------------------------------------------------------------------------

/**
 * Server action: sign in with email + password.
 *
 * On success, fetches the profile role and redirects:
 *   super_admin          → /admin
 *   restaurant_owner/staff → /dashboard
 *   visitor (default)    → /
 *
 * Returns { error: string } on failure so the form can display it.
 */
export async function signIn(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const result = signInSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid input." };
  }

  const { email, password } = result.data;
  const supabase = createClient();

  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    return { error: authError.message };
  }

  // Fetch profile to determine redirect destination.
  const { data: userData } = await supabase.auth.getUser();
  let redirectPath = "/";

  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    const role = (profile?.role ?? "visitor") as UserRole;

    if (role === "super_admin") {
      redirectPath = "/admin";
    } else if (role === "restaurant_owner" || role === "restaurant_staff") {
      redirectPath = "/dashboard";
    }
  }

  redirect(redirectPath);
}

// ---------------------------------------------------------------------------
// signUp
// ---------------------------------------------------------------------------

/**
 * Server action: create a new account with email, password, and full name.
 *
 * Passes full_name in options.data so the on_auth_user_created trigger can
 * copy it into public.profiles.full_name.
 *
 * On success, redirects to / (new accounts get the 'visitor' role by default).
 */
export async function signUp(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
  };

  const result = signUpSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid input." };
  }

  const { email, password, full_name } = result.data;
  const supabase = createClient();

  const { error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
      },
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  // New accounts are 'visitor' by default - send to home.
  redirect("/");
}

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

/**
 * Server action: sign out the current user and redirect to /.
 */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/");
}
