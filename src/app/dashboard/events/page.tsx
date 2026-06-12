import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEventsForDashboard } from "@/lib/event-queries";
import { CreateEventForm } from "./event-forms";
import { EditEventForm } from "./event-forms";
import { EventImageUploader } from "./event-image-uploader";
import type { EventWithStats } from "@/lib/event-queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO UTC timestamptz as "DD Mon YYYY HH:MM UTC"
 */
function fmtDatetime(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleString("en-US", {
    year:     "numeric",
    month:    "short",
    day:      "numeric",
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
    timeZone: "UTC",
  }) + " UTC";
}

/**
 * Format price_cents as a human-readable string.
 * price_cents = 0 → "Free"
 * otherwise → "$X.XX USD" (using currency symbol where known)
 */
function fmtPrice(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const symbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", rub: "₽" };
  const sym = symbols[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

interface SummaryCardsProps {
  events: EventWithStats[];
}

function SummaryCards({ events }: SummaryCardsProps) {
  const totalEvents     = events.length;
  const publishedEvents = events.filter((e) => e.is_published).length;
  const totalSold       = events.reduce((acc, e) => acc + e.sold, 0);
  const totalRevenue    = events.reduce((acc, e) => acc + e.revenue_cents, 0);

  const cards = [
    { label: "Total events",      value: String(totalEvents),      cls: "bg-gray-50 border-gray-200 text-gray-800" },
    { label: "Published",         value: String(publishedEvents),  cls: "bg-green-50 border-green-200 text-green-800" },
    { label: "Tickets sold",      value: String(totalSold),        cls: "bg-blue-50 border-blue-200 text-blue-800" },
    { label: "Revenue (paid)",    value: `$${(totalRevenue / 100).toFixed(2)}`, cls: "bg-amber-50 border-amber-200 text-amber-800" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(({ label, value, cls }) => (
        <div key={label} className={`rounded-lg border px-4 py-3 text-center ${cls}`}>
          <div className="text-xl font-bold tabular-nums">{value}</div>
          <div className="text-xs font-medium mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

interface EventCardProps {
  event: EventWithStats;
  tenantId: string;
}

function EventCard({ event, tenantId }: EventCardProps) {
  const remaining = Math.max(0, event.capacity - event.sold);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {/* Card header */}
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <h2 className="flex-1 min-w-0 text-base font-semibold text-gray-900 truncate">
            {event.title}
          </h2>
          {event.is_published ? (
            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
              Published
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              Draft
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
          <span>
            <span className="font-medium text-gray-700">{fmtDatetime(event.starts_at)}</span>
          </span>
          <span>
            Capacity:{" "}
            <span className="font-medium text-gray-700">{event.capacity}</span>
          </span>
          <span>
            Sold:{" "}
            <span className="font-medium text-gray-700">{event.sold}</span>
          </span>
          <span>
            Remaining:{" "}
            <span className="font-medium text-gray-700">{remaining}</span>
          </span>
          <span>
            Price:{" "}
            <span className="font-medium text-gray-700">
              {fmtPrice(event.price_cents, event.currency)}
            </span>
          </span>
          <span>
            Revenue (paid):{" "}
            <span className="font-medium text-gray-700">
              {fmtPrice(event.revenue_cents, event.currency)}
            </span>
          </span>
        </div>
      </div>

      {/* Event image uploader */}
      <div className="border-b border-gray-100 px-6 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Event image
        </p>
        <EventImageUploader
          tenantId={tenantId}
          eventId={event.id}
          currentImageUrl={event.image_url}
        />
      </div>

      {/* Edit form */}
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Edit event
        </p>
        <EditEventForm event={event} />
      </div>

      {/* Attendees link */}
      <div className="px-6 py-4">
        <Link
          href={`/dashboard/events/${event.id}`}
          className="inline-flex items-center rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          View attendees &rarr;
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EventsPage() {
  const profile = await getProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.tenant_id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5">
        <p className="text-sm text-red-700">
          Your account is not associated with a restaurant. Contact support.
        </p>
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const events = await getEventsForDashboard(tenantId);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your ticketed events and sales. All times are UTC.
        </p>
      </div>

      {/* Summary cards */}
      <SummaryCards events={events} />

      {/* Create event */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Add event
        </h2>
        <CreateEventForm />
      </section>

      {/* Events list */}
      {events.length === 0 ? (
        <p className="text-sm text-gray-500">
          No events yet. Create one above to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {events.map((event) => (
            <EventCard key={event.id} event={event} tenantId={tenantId} />
          ))}
        </div>
      )}
    </div>
  );
}
