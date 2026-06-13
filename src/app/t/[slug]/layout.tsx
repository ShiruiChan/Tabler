import { requireTenant } from "@/lib/tenant";
import { getSiteSettings } from "@/lib/site-settings";
import { buildThemeStyle, googleFontsUrl } from "@/lib/theme";

// Force dynamic rendering: this layout calls requireTenant → createClient →
// next/headers cookies(), which requires a request context and cannot be
// statically pre-rendered at build time.
export const dynamic = "force-dynamic";

interface TenantLayoutProps {
  children: React.ReactNode;
  params: { slug: string };
}

/**
 * Tenant shell layout.
 *
 * Fetches the tenant (404-ing on unknown slugs) and its site_settings row,
 * then applies the per-tenant theme as CSS custom properties on a wrapper div.
 *
 * ── logo_url decision ────────────────────────────────────────────────────────
 * The `logo_url` column stores the *full public URL* returned by Supabase
 * Storage (or any external CDN URL supplied by the tenant owner), NOT a raw
 * storage-bucket object path.  Therefore the layout renders it directly with
 * <img src={settings.logo_url} /> rather than routing it through
 * getPublicAssetUrl().  getPublicAssetUrl() is used only when you have a raw
 * bucket-relative path (e.g. "{tenantId}/logo.png"); it is intentionally not
 * called here.  This decision keeps the data model simple: the settings editor
 * stores the resolved URL once on save, so every reader (layout, OG image
 * handler, etc.) can use the value as-is.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Google Fonts <link> is rendered inline in the layout.  App Router hoists
 * <link> tags from Server Components into <head> automatically (Next 14+), so
 * no special handling is required.
 *
 * If no site_settings row exists (tenant exists but settings not yet saved),
 * buildThemeStyle(null) and googleFontsUrl(null) fall back to DEFAULT_THEME
 * - Inter colours - so the layout never crashes.
 */
export default async function TenantLayout({
  children,
  params,
}: TenantLayoutProps) {
  const tenant = await requireTenant(params.slug);
  const settings = await getSiteSettings(tenant.id);

  const themeStyle = buildThemeStyle(settings);
  const fontsUrl = googleFontsUrl(settings);

  return (
    // Cast to React.CSSProperties because CSS custom properties are not part
    // of that type definition but are fully supported by React at runtime.
    <div
      style={themeStyle as React.CSSProperties}
      className="min-h-screen"
    >
      {fontsUrl && (
        // App Router hoists <link> tags from server components into <head>.
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="stylesheet" href={fontsUrl} />
      )}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          backgroundColor: "color-mix(in srgb, var(--color-secondary) 88%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          {settings?.logo_url && (
            // logo_url is a full public URL (see decision note above).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logo_url}
              alt={`${tenant.name} logo`}
              className="h-10 w-auto object-contain"
            />
          )}
          <span
            className="text-lg font-semibold tracking-tight"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--color-primary)",
            }}
          >
            {tenant.name}
          </span>
        </div>
      </header>
      <main
        style={{
          fontFamily: "var(--font-body)",
          backgroundColor: "var(--color-secondary)",
        }}
      >
        {children}
      </main>
    </div>
  );
}
