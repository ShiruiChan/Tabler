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
  website: "Сайт",
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

  // Navigation tiles for the enabled modules - rendered as a refined grid below
  // the hero so guests can discover every section at a glance.
  const navTiles: { href: string; label: string; description: string }[] = [];
  if (menuEnabled)
    navTiles.push({ href: "./menu", label: "Меню", description: "Наши блюда и напитки" });
  if (reservationsEnabled)
    navTiles.push({ href: "./reserve", label: "Бронирование", description: "Забронируйте столик" });
  if (floorEnabled)
    navTiles.push({ href: "./floor", label: "Зал", description: "Выберите место в зале" });
  if (orderingEnabled)
    navTiles.push({ href: "./order", label: "Заказ", description: "Закажите онлайн" });
  if (eventsEnabled)
    navTiles.push({ href: "./events", label: "События", description: "Афиша и билеты" });

  const hasHeroImage = !!settings?.hero_image_url;

  return (
    <div className="font-body">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6 py-28 text-center"
        style={
          hasHeroImage
            ? {
                backgroundImage: `url(${settings!.hero_image_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundColor: "var(--color-secondary)" }
        }
      >
        {/* Gradient overlay when a hero image is present for legible text */}
        {hasHeroImage && (
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60"
            aria-hidden="true"
          />
        )}

        <div className="animate-fade-up relative z-10 flex flex-col items-center">
          <h1
            className={[
              "font-heading text-5xl font-bold tracking-tight md:text-7xl",
              hasHeroImage ? "text-white drop-shadow-sm" : "",
            ].join(" ")}
            style={hasHeroImage ? undefined : { color: "var(--color-primary)" }}
          >
            {tenant.name}
          </h1>

          {settings?.tagline && (
            <p
              className={[
                "mt-5 max-w-2xl text-lg leading-relaxed md:text-2xl",
                hasHeroImage ? "text-white/90" : "",
              ].join(" ")}
              style={hasHeroImage ? undefined : { color: "var(--color-primary)", opacity: 0.7 }}
            >
              {settings.tagline}
            </p>
          )}

          {/* Primary CTAs: first action solid accent, learn-more outlined */}
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {reservationsEnabled && (
              <a
                href="./reserve"
                className="inline-flex items-center rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                Забронировать столик
              </a>
            )}
            {menuEnabled && (
              <a
                href="./menu"
                className="inline-flex items-center rounded-full px-7 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={
                  hasHeroImage
                    ? {
                        backgroundColor: "rgba(255,255,255,0.12)",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.5)",
                        backdropFilter: "blur(4px)",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "var(--color-primary)",
                        border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
                      }
                }
              >
                Смотреть меню
              </a>
            )}
            {settings?.about && (
              <a
                href="#about"
                className={[
                  "inline-flex items-center rounded-full px-7 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2",
                  hasHeroImage ? "text-white/90 hover:text-white" : "",
                ].join(" ")}
                style={hasHeroImage ? undefined : { color: "var(--color-primary)", opacity: 0.7 }}
              >
                Подробнее
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── Explore (module navigation tiles) ───────────────────────── */}
      {navTiles.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {navTiles.map((tile) => (
              <a
                key={tile.href}
                href={tile.href}
                className="group flex flex-col rounded-2xl border bg-white/60 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={{ borderColor: "rgba(0,0,0,0.08)" }}
              >
                <span
                  className="font-heading text-xl font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {tile.label}
                </span>
                <span
                  className="mt-1.5 text-sm leading-relaxed"
                  style={{ color: "var(--color-primary)", opacity: 0.6 }}
                >
                  {tile.description}
                </span>
                <span
                  className="mt-4 inline-flex items-center text-sm font-medium transition group-hover:translate-x-0.5"
                  style={{ color: "var(--color-accent)" }}
                  aria-hidden="true"
                >
                  Перейти →
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── About ────────────────────────────────────────────────────── */}
      {settings?.about && (
        <section
          id="about"
          className="mx-auto max-w-3xl scroll-mt-24 px-6 py-16"
        >
          <span
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-accent)" }}
          >
            О нас
          </span>
          <h2
            className="font-heading mb-6 mt-2 text-3xl font-semibold md:text-4xl"
            style={{ color: "var(--color-primary)" }}
          >
            Добро пожаловать
          </h2>
          <p
            className="font-body whitespace-pre-line text-base leading-relaxed md:text-lg"
            style={{ color: "var(--color-primary)", opacity: 0.8 }}
          >
            {settings.about}
          </p>
        </section>
      )}

      {/* ── Social links ─────────────────────────────────────────────── */}
      {socialEntries.length > 0 && (
        <section
          className="mt-8 py-14"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 text-center">
            <span className="font-heading text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
              Мы в сети
            </span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {socialEntries.map(({ platform, url }) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  {PLATFORM_LABELS[platform]}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
