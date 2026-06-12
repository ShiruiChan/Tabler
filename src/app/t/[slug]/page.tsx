import { requireTenant } from "@/lib/tenant";
import { getSiteSettings } from "@/lib/site-settings";
import { tenantHasModule, MODULES } from "@/lib/modules";

// Force dynamic rendering for the same reason as the parent layout:
// requireTenant / getSiteSettings call next/headers via the Supabase server
// client and cannot be statically pre-rendered at build time.
export const dynamic = "force-dynamic";

interface TenantHomeProps {
  params: { slug: string };
}

// ---------------------------------------------------------------------------
// Social-link helpers
// ---------------------------------------------------------------------------

/** Ordered list of social platforms we render. Unknown keys are ignored. */
const KNOWN_SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "website",
] as const;

type KnownPlatform = (typeof KNOWN_SOCIAL_PLATFORMS)[number];

/** Human-readable label for each known platform. */
const PLATFORM_LABELS: Record<KnownPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X (Twitter)",
  tiktok: "TikTok",
  website: "Website",
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Tenant home page.
 *
 * Exercises the per-tenant theme (set by the parent layout via CSS custom
 * properties on the wrapper div) using Tailwind's extended theme classes:
 *   bg-primary / bg-secondary / bg-accent
 *   text-primary / text-accent
 *   font-heading / font-body
 *
 * All sections degrade gracefully when optional fields (hero_image_url,
 * tagline, about, social) are null / empty.
 */
export default async function TenantHome({ params }: TenantHomeProps) {
  const tenant = await requireTenant(params.slug);
  const [settings, menuEnabled, floorEnabled, reservationsEnabled, eventsEnabled, orderingEnabled] =
    await Promise.all([
      getSiteSettings(tenant.id),
      tenantHasModule(tenant.id, "menu"),
      tenantHasModule(tenant.id, "floor_plan"),
      tenantHasModule(tenant.id, "reservations"),
      tenantHasModule(tenant.id, "events"),
      tenantHasModule(tenant.id, MODULES.ordering),
    ]);

  // Resolve social links, keeping only known platforms in declared order.
  const socialEntries: { platform: KnownPlatform; url: string }[] = [];
  if (settings?.social) {
    for (const platform of KNOWN_SOCIAL_PLATFORMS) {
      const url = settings.social[platform];
      if (url) socialEntries.push({ platform, url });
    }
  }

  return (
    <div className="font-body">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center"
        style={
          settings?.hero_image_url
            ? {
                backgroundImage: `url(${settings.hero_image_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundColor: "var(--color-secondary)" }
        }
      >
        {/* Semi-transparent overlay when a hero image is present */}
        {settings?.hero_image_url && (
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
        )}

        <div className="relative z-10">
          <h1
            className={[
              "font-heading text-4xl font-bold tracking-tight md:text-6xl",
              settings?.hero_image_url ? "text-white" : "text-primary",
            ].join(" ")}
          >
            {tenant.name}
          </h1>

          {settings?.tagline && (
            <p
              className={[
                "mt-4 max-w-xl text-lg md:text-xl",
                settings.hero_image_url ? "text-white/90" : "text-primary/80",
              ].join(" ")}
            >
              {settings.tagline}
            </p>
          )}

          {/* Accent CTA buttons */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#about"
              className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            >
              Learn more
            </a>
            {menuEnabled && (
              <a
                href="./menu"
                className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                View menu
              </a>
            )}
            {floorEnabled && (
              <a
                href="./floor"
                className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                View floor plan
              </a>
            )}
            {reservationsEnabled && (
              <a
                href="./reserve"
                className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                Reserve a table
              </a>
            )}
            {eventsEnabled && (
              <a
                href="./events"
                className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                Events
              </a>
            )}
            {orderingEnabled && (
              <a
                href="./order"
                className="inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                Order
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────────────── */}
      {settings?.about && (
        <section
          id="about"
          className="mx-auto max-w-3xl px-6 py-16"
          style={{ color: "var(--color-primary)" }}
        >
          <h2 className="font-heading mb-6 text-3xl font-semibold text-primary">
            About Us
          </h2>
          <p className="font-body whitespace-pre-line text-base leading-relaxed">
            {settings.about}
          </p>
        </section>
      )}

      {/* ── Social links ─────────────────────────────────────────────── */}
      {socialEntries.length > 0 && (
        <section
          className="py-12"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-4 px-6">
            <span className="font-heading text-sm font-semibold uppercase tracking-widest text-white/60">
              Find us online
            </span>
            {socialEntries.map(({ platform, url }) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                {PLATFORM_LABELS[platform]}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
