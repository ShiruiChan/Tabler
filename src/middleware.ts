import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ---------------------------------------------------------------------------
// Host-parsing helpers
// ---------------------------------------------------------------------------

/**
 * Strip the port suffix from a host string so that "localhost:3000" compares
 * equal to a ROOT_DOMAIN of "localhost:3000" as-is, but also handles the case
 * where ROOT_DOMAIN has no port (e.g. "tabler.app") and the host header never
 * carries a port in production.
 *
 * We keep the port in ROOT_DOMAIN when present (dev), so comparison must be
 * done against the full host string - we only strip port from the incoming
 * host when ROOT_DOMAIN itself has no port, to handle browsers that sometimes
 * omit the default ":80"/":443".
 */
function normaliseHost(host: string, rootDomain: string): string {
  // If rootDomain has no port component, strip port from host for comparison.
  if (!rootDomain.includes(":")) {
    return host.replace(/:\d+$/, "");
  }
  return host;
}

type RouteKind =
  | { kind: "platform" }
  | { kind: "admin" }
  | { kind: "tenant-slug"; slug: string }
  | { kind: "custom-domain"; host: string };

/**
 * Classify an incoming host into one of four route kinds.
 *
 * @param rawHost  The raw `Host` header value (may include port).
 * @param rootDomain  NEXT_PUBLIC_ROOT_DOMAIN env var value.
 */
function classifyHost(rawHost: string, rootDomain: string): RouteKind {
  const host = normaliseHost(rawHost, rootDomain);
  const root = normaliseHost(rootDomain, rootDomain);

  // Exact root or www → platform
  if (host === root || host === `www.${root}`) {
    return { kind: "platform" };
  }

  // Must be a subdomain of root to be admin or tenant-slug
  if (host.endsWith(`.${root}`)) {
    const subdomain = host.slice(0, host.length - root.length - 1); // strip ".root"

    if (subdomain === "admin") {
      return { kind: "admin" };
    }

    // Guard: reject empty slugs or multi-level subdomains (contain a dot).
    // Treat these as custom-domain / 404 rather than invalid tenant slugs.
    if (!subdomain || subdomain.includes(".")) {
      return { kind: "custom-domain", host: rawHost };
    }

    // Any other single-label subdomain is treated as a tenant slug.
    // Deeper validation happens in the page layer - middleware stays fast.
    return { kind: "tenant-slug", slug: subdomain };
  }

  // Not the root domain at all → custom domain lookup required.
  return { kind: "custom-domain", host: rawHost };
}

// ---------------------------------------------------------------------------
// Protected-path guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the (post-rewrite) pathname targets a route that requires
 * authentication.  Role checking is deferred to the page layer via requireRole;
 * middleware only verifies that a session exists.
 */
function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  );
}

// ---------------------------------------------------------------------------
// Custom-domain → slug lookup
// ---------------------------------------------------------------------------

/**
 * Resolve a custom domain to an active tenant slug via Supabase REST.
 *
 * We use the anon key here; the RLS policy "tenants: public read active"
 * exposes only status='active' rows to the anon role, so this is safe without
 * any additional filtering (though we also add ?status=eq.active for clarity).
 *
 * TODO (future): add an in-memory or edge-cache layer (e.g. Vercel KV) so that
 * each custom-domain request doesn't always incur a Supabase round-trip.
 */
async function resolveCustomDomain(
  customDomain: string,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<string | null> {
  const url =
    `${supabaseUrl}/rest/v1/tenants` +
    `?select=slug` +
    `&custom_domain=eq.${encodeURIComponent(customDomain)}` +
    `&status=eq.active` +
    `&limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: "application/json",
      },
      // Edge runtime does support fetch; use no-store to avoid stale results.
      cache: "no-store",
    });

    if (!res.ok) return null;

    const rows = (await res.json()) as Array<{ slug: string }>;
    return rows[0]?.slug ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware entry point
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  // If Supabase env vars are missing at runtime, skip session refresh but
  // still handle routing.  (Dev without a real Supabase project should work.)
  const canRefreshSession = Boolean(supabaseUrl && supabaseAnonKey);

  const rawHost =
    request.headers.get("host") ?? request.nextUrl.hostname ?? "localhost:3000";

  const route = classifyHost(rawHost, rootDomain);
  const { pathname } = request.nextUrl;

  // -------------------------------------------------------------------------
  // STEP 1: Run Supabase session refresh FIRST (canonical @supabase/ssr order).
  //
  // We collect any cookies that the refresh wants to set so we can apply them
  // to whichever final response we build below.  We also apply them to the
  // request's cookie jar immediately so subsequent middleware reads see them.
  // -------------------------------------------------------------------------
  type PendingCookie = { name: string; value: string; options: Record<string, unknown> };
  const pendingCookies: PendingCookie[] = [];

  // Capture the authenticated user so we can enforce path-level auth guards
  // below (role checking remains in the page layer via requireRole).
  let authenticatedUser: { id: string } | null = null;

  if (canRefreshSession) {
    const supabase = createServerClient(supabaseUrl!, supabaseAnonKey!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // (a) Mutate the request cookie jar so downstream reads see the
          //     refreshed tokens within this middleware invocation.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // (b) Record them for application to the final response once it
          //     is constructed below.
          cookiesToSet.forEach(({ name, value, options }) =>
            pendingCookies.push({ name, value, options: options as Record<string, unknown> })
          );
        },
      },
    });

    // getUser() triggers token refresh when the access token is expired.
    // We also save the result for auth-guard checks on protected paths.
    const { data } = await supabase.auth.getUser();
    authenticatedUser = data.user ?? null;
  }

  // Helper: apply pending cookies to a response, then return it.
  // Used for both normal responses and the 404 fallbacks so that any freshly
  // refreshed auth tokens are always forwarded to the browser.
  function applyPendingCookies(res: NextResponse): NextResponse {
    for (const { name, value, options } of pendingCookies) {
      res.cookies.set(name, value, options);
    }
    return res;
  }

  // Helper: build a redirect to /login preserving the requested URL as `next`.
  function redirectToLogin(targetPath: string): NextResponse {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", targetPath);
    return applyPendingCookies(NextResponse.redirect(loginUrl));
  }

  // -------------------------------------------------------------------------
  // STEP 2: Classify the host and build the final response.
  //
  // x-tenant-slug is injected into the REQUEST headers forwarded to the
  // rewrite target so that server components can read it via headers().
  // -------------------------------------------------------------------------

  // Build a mutable copy of the incoming request headers.  We will add
  // x-tenant-slug here when appropriate, and pass this as the forwarded
  // request headers for any rewrite.
  const requestHeaders = new Headers(request.headers);

  // TypeScript requires initialization even though all switch branches assign.
  let response: NextResponse = NextResponse.next();

  switch (route.kind) {
    case "platform": {
      // Check if the platform path targets a protected segment.
      // /admin/* on the platform host is an edge case (normally reached via
      // admin subdomain rewrite), but we guard it here for defence-in-depth.
      const rewrittenPath = pathname;
      if (isProtectedPath(rewrittenPath) && !authenticatedUser) {
        return redirectToLogin(rewrittenPath);
      }
      // No rewrite - the request path is already under the (platform) group.
      response = NextResponse.next({ request: { headers: requestHeaders } });
      break;
    }

    case "admin": {
      // The admin subdomain rewrites / → /admin and /foo → /admin/foo.
      // Protect the rewritten path (not the original pathname) since /admin
      // is always the target.
      const rewrittenPath = `/admin${pathname === "/" ? "" : pathname}`;
      if (!authenticatedUser) {
        return redirectToLogin(rewrittenPath);
      }
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = rewrittenPath;
      response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
      break;
    }

    case "tenant-slug": {
      const { slug } = route;
      // Inject the tenant slug into the forwarded request headers so that
      // server components can call headers().get("x-tenant-slug").
      requestHeaders.set("x-tenant-slug", slug);
      // Rewrite /path → /t/[slug]/path (no DB lookup - fast path)
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/t/${slug}${pathname === "/" ? "" : pathname}`;
      response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
      break;
    }

    case "custom-domain": {
      if (!canRefreshSession) {
        // Can't resolve without Supabase env vars - return 404.
        // Route through applyPendingCookies so any refreshed tokens are sent.
        return applyPendingCookies(
          new NextResponse("Not Found", { status: 404 })
        );
      }

      const slug = await resolveCustomDomain(
        route.host,
        supabaseUrl!,
        supabaseAnonKey!
      );

      if (!slug) {
        // Unknown custom domain - 404, but still apply pending cookies.
        return applyPendingCookies(
          new NextResponse("Not Found", { status: 404 })
        );
      }

      // Inject the resolved tenant slug into the forwarded request headers.
      requestHeaders.set("x-tenant-slug", slug);
      // Resolved: rewrite to tenant route exactly as subdomain path.
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/t/${slug}${pathname === "/" ? "" : pathname}`;
      response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
      break;
    }
  }

  // -------------------------------------------------------------------------
  // STEP 3: Copy any refreshed auth cookies onto the final response so the
  // browser receives the updated tokens.
  // -------------------------------------------------------------------------
  return applyPendingCookies(response);
}

// ---------------------------------------------------------------------------
// Matcher - skip static assets, _next internals, and API routes
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (static files)
     *  - _next/image   (image optimisation)
     *  - favicon.ico   (favicon)
     *  - Files with a common static extension
     *  - api           (API routes - handled separately)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
