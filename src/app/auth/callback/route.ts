import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback
 *
 * OAuth / email-confirmation callback handler.
 * Exchanges the `code` query parameter for a Supabase session, then redirects
 * to the `next` query parameter (if present and relative) or to the home page.
 *
 * This is the standard @supabase/ssr pattern for handling the PKCE auth flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Validate `next` is a relative path to prevent open-redirect attacks.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  // Exchange failed or no code provided - redirect to login with an error hint.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
