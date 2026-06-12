import { getProfile } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getEventsForDashboard, getEventTicketsForDashboard } from "@/lib/event-queries";
import { TicketStatusActions } from "../ticket-status-actions";
import type { EventTicket, EventTicketStatus } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fmtPrice(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const symbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", rub: "₽" };
  const sym = symbols[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Status summary
// ---------------------------------------------------------------------------

interface TicketSummaryProps {
  tickets: EventTicket[];
}

function TicketSummary({ tickets }: TicketSummaryProps) {
  const counts: Record<EventTicketStatus, number> = {
    reserved:  0,
    paid:      0,
    cancelled: 0,
    refunded:  0,
  };
  let totalQty = 0;
  let paidRevenue = 0;

  for (const t of tickets) {
    counts[t.status]++;
    if (t.status === "reserved" || t.status === "paid") {
      totalQty += t.quantity;
    }
    if (t.status === "paid") {
      paidRevenue += t.quantity * t.unit_price_cents;
    }
  }

  const cards = [
    { label: "Reserved",  value: String(counts.reserved),  cls: "bg-amber-50 border-amber-200 text-amber-800" },
    { label: "Paid",      value: String(counts.paid),      cls: "bg-green-50 border-green-200 text-green-800" },
    { label: "Cancelled", value: String(counts.cancelled), cls: "bg-gray-50 border-gray-200 text-gray-600" },
    { label: "Refunded",  value: String(counts.refunded),  cls: "bg-blue-50 border-blue-200 text-blue-800" },
    { label: "Active qty", value: String(totalQty),        cls: "bg-gray-50 border-gray-200 text-gray-800" },
    { label: "Revenue",   value: paidRevenue > 0 ? `$${(paidRevenue / 100).toFixed(2)}` : "—", cls: "bg-gray-50 border-gray-200 text-gray-800" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
// Page props
// ---------------------------------------------------------------------------

interface AttendeePageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EventAttendeesPage({ params }: AttendeePageProps) {
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
  const { id: eventId } = await params;

  // Load the event (from the tenant's events list — already auth-checked)
  const events = await getEventsForDashboard(tenantId);
  const event = events.find((e) => e.id === eventId);

  if (!event) {
    notFound();
  }

  const tickets = await getEventTicketsForDashboard(tenantId, eventId);

  const remaining = Math.max(0, event.capacity - event.sold);

  return (
    <div className="space-y-8">
      {/* Back link */}
      <div>
        <Link
          href="/dashboard/events"
          className="text-sm font-medium text-gray-500 hover:text-gray-900 transition"
        >
          &larr; Back to events
        </Link>
      </div>

      {/* Page header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
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
        <p className="mt-1 text-sm text-gray-500">
          {fmtDatetime(event.starts_at)}
          {event.ends_at ? ` — ${fmtDatetime(event.ends_at)}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
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
            Ticket price:{" "}
            <span className="font-medium text-gray-700">
              {fmtPrice(event.price_cents, event.currency)}
            </span>
          </span>
        </div>
      </div>

      {/* Ticket summary */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Sales overview
        </h2>
        <TicketSummary tickets={tickets} />
      </section>

      {/* Attendee list */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Attendees{" "}
          <span className="text-sm font-normal text-gray-500">
            ({tickets.length} order{tickets.length !== 1 ? "s" : ""})
          </span>
        </h2>

        {tickets.length === 0 ? (
          <p className="text-sm text-gray-400">No ticket orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4 text-left">Buyer</th>
                  <th className="pb-2 pr-4 text-left">Contact</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Qty</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Unit price</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Total</th>
                  <th className="pb-2 pr-4 text-left">Ordered at</th>
                  <th className="pb-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="align-top">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-gray-900">
                        {ticket.buyer_name}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      <div className="space-y-0.5">
                        {ticket.buyer_email && (
                          <div className="truncate max-w-[160px]">
                            {ticket.buyer_email}
                          </div>
                        )}
                        {ticket.buyer_phone && (
                          <div>{ticket.buyer_phone}</div>
                        )}
                        {!ticket.buyer_email && !ticket.buyer_phone && (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {ticket.quantity}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-500">
                      {fmtPrice(ticket.unit_price_cents, ticket.currency)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-gray-900">
                      {fmtPrice(ticket.quantity * ticket.unit_price_cents, ticket.currency)}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                      {fmtDatetime(ticket.created_at)}
                    </td>
                    <td className="py-2">
                      <TicketStatusActions
                        ticketId={ticket.id}
                        tenantId={tenantId}
                        currentStatus={ticket.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
