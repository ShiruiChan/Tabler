import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { tenantHasModule } from "@/lib/modules";
import { getPublicEvents, getMyTickets } from "@/lib/event-queries";
import { TicketCheckout } from "./ticket-checkout";
import { MyTickets } from "./my-tickets";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface EventsPageProps {
  params: { slug: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  rub: "₽",
};

/** Cents → formatted price string, "Бесплатно" when zero. */
function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Бесплатно";
  const sym = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

/** ISO UTC string → "Weekday, D Month YYYY в HH:MM UTC" */
function formatEventDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  const datePart = d.toLocaleDateString("ru-RU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${datePart} в ${hh}:${mm} UTC`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function EventsPage({ params }: EventsPageProps) {
  const tenant = await requireTenant(params.slug);

  const eventsEnabled = await tenantHasModule(tenant.id, "events");
  if (!eventsEnabled) {
    notFound();
  }

  // Load public events + check if the visitor is authenticated (for My Tickets).
  const supabase = createClient();
  const [events, { data: userData }] = await Promise.all([
    getPublicEvents(tenant.id),
    supabase.auth.getUser(),
  ]);

  const isAuthenticated = !!userData?.user;
  // getMyTickets is user-scoped across all tenants; filter to this tenant so
  // another restaurant's tickets never appear on this white-label site.
  const myTickets = isAuthenticated
    ? (await getMyTickets()).filter((t) => t.tenant_id === tenant.id)
    : [];

  return (
    <div
      className="font-body min-h-screen"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* ── Page heading ──────────────────────────────────────────────── */}
        <header className="animate-fade-up mb-10">
          <span
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-accent)" }}
          >
            {tenant.name}
          </span>
          <h1
            className="font-heading mt-2 text-4xl font-bold tracking-tight md:text-5xl"
            style={{ color: "var(--color-primary)" }}
          >
            События
          </h1>
        </header>

        {/* ── Event cards ───────────────────────────────────────────────── */}
        {events.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: "rgba(0,0,0,0.12)" }}
          >
            <p
              className="text-base"
              style={{ color: "var(--color-primary)", opacity: 0.65 }}
            >
              Сейчас нет предстоящих событий. Загляните позже!
            </p>
          </div>
        ) : (
          <section aria-label="Предстоящие события" className="space-y-8 mb-16">
            {events.map((event) => {
              const isSoldOut = event.remaining === 0;
              return (
                <article
                  key={event.id}
                  className="rounded-2xl border bg-white/60 overflow-hidden shadow-sm transition hover:shadow-md"
                  style={{ borderColor: "rgba(0,0,0,0.08)" }}
                >
                  {/* Cover image */}
                  {event.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.image_url}
                      alt={event.title}
                      className="w-full h-52 object-cover"
                    />
                  )}

                  <div className="p-6">
                    {/* Title + price row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                      <h2
                        className="font-heading text-xl font-semibold leading-snug"
                        style={{ color: "var(--color-primary)" }}
                      >
                        {event.title}
                      </h2>
                      <span
                        className="shrink-0 text-base font-semibold"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {formatPrice(event.price_cents, event.currency)}
                      </span>
                    </div>

                    {/* Date/time (UTC) */}
                    <p
                      className="text-sm mb-2"
                      style={{ color: "var(--color-primary)", opacity: 0.65 }}
                    >
                      {formatEventDate(event.starts_at)}
                      {event.ends_at && (
                        <>
                          {" "}–{" "}
                          {formatEventDate(event.ends_at)}
                        </>
                      )}
                    </p>

                    {/* Availability */}
                    <p
                      className="text-xs font-medium mb-3"
                      style={{
                        color: isSoldOut
                          ? "rgb(220,38,38)"
                          : "var(--color-primary)",
                        opacity: isSoldOut ? 1 : 0.55,
                      }}
                    >
                      {isSoldOut
                        ? "Билеты распроданы"
                        : `Осталось билетов: ${event.remaining}`}
                    </p>

                    {/* Description */}
                    {event.description && (
                      <p
                        className="text-sm leading-relaxed mb-4"
                        style={{ color: "var(--color-primary)", opacity: 0.75 }}
                      >
                        {event.description}
                      </p>
                    )}

                    {/* Checkout island */}
                    <TicketCheckout event={event} tenantId={tenant.id} />
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {/* ── My tickets (authenticated visitors only) ───────────────────── */}
        {isAuthenticated && (
          <section aria-label="Мои билеты">
            <h2
              className="font-heading text-2xl font-bold mb-2"
              style={{ color: "var(--color-primary)" }}
            >
              Мои билеты
            </h2>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--color-primary)", opacity: 0.6 }}
            >
              История билетов в {tenant.name}
            </p>
            <MyTickets tickets={myTickets} />
          </section>
        )}
      </div>
    </div>
  );
}
