import { getProfile } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getEventsForDashboard, getEventTicketsForDashboard } from "@/lib/event-queries";
import { TicketStatusActions } from "../ticket-status-actions";
import type { EventTicket, EventTicketStatus } from "@/lib/types/database";
import { PageHeader, PanelCard, StatCard, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDatetime(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleString("ru-RU", {
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
  if (cents === 0) return "Бесплатно";
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
    { label: "Забронировано", value: String(counts.reserved) },
    { label: "Оплачено",      value: String(counts.paid) },
    { label: "Отменено",      value: String(counts.cancelled) },
    { label: "Возвращено",    value: String(counts.refunded) },
    { label: "Активных мест", value: String(totalQty) },
    { label: "Выручка",       value: paidRevenue > 0 ? `$${(paidRevenue / 100).toFixed(2)}` : "-" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ label, value }) => (
        <StatCard key={label} stat={value} label={label} />
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
      <div className="alert-error">
        <p>
          Ваш аккаунт не привязан к ресторану. Обратитесь в поддержку.
        </p>
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const { id: eventId } = await params;

  // Load the event (from the tenant's events list - already auth-checked)
  const events = await getEventsForDashboard(tenantId);
  const event = events.find((e) => e.id === eventId);

  if (!event) {
    notFound();
  }

  const tickets = await getEventTicketsForDashboard(tenantId, eventId);

  const remaining = Math.max(0, event.capacity - event.sold);

  return (
    <div className="space-y-8">
      <Link
        href="/dashboard/events"
        className="inline-block text-sm font-medium text-amber-400 transition hover:text-amber-300"
      >
        &larr; Назад к событиям
      </Link>
      <PageHeader
        eyebrow="События"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {event.title}
            {event.is_published ? (
              <Badge tone="emerald">Опубликовано</Badge>
            ) : (
              <Badge tone="slate">Черновик</Badge>
            )}
          </span>
        }
        description={
          <>
            {fmtDatetime(event.starts_at)}
            {event.ends_at ? ` - ${fmtDatetime(event.ends_at)}` : ""}
            <span className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>
                Вместимость:{" "}
                <span className="font-medium text-slate-300">{event.capacity}</span>
              </span>
              <span>
                Продано:{" "}
                <span className="font-medium text-slate-300">{event.sold}</span>
              </span>
              <span>
                Осталось:{" "}
                <span className="font-medium text-slate-300">{remaining}</span>
              </span>
              <span>
                Цена билета:{" "}
                <span className="font-medium text-slate-300">
                  {fmtPrice(event.price_cents, event.currency)}
                </span>
              </span>
            </span>
          </>
        }
      />

      {/* Ticket summary */}
      <PanelCard title="Обзор продаж">
        <TicketSummary tickets={tickets} />
      </PanelCard>

      {/* Attendee list */}
      <PanelCard
        title={
          <>
            Участники{" "}
            <span className="text-sm font-normal text-slate-400">
              ({tickets.length} {tickets.length === 1 ? "заказ" : "заказов"})
            </span>
          </>
        }
      >
        {tickets.length === 0 ? (
          <p className="text-sm text-slate-500">Пока нет заказов билетов.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4 text-left">Покупатель</th>
                  <th className="pb-2 pr-4 text-left">Контакт</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Кол-во</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Цена за шт.</th>
                  <th className="pb-2 pr-4 text-right tabular-nums">Итого</th>
                  <th className="pb-2 pr-4 text-left">Заказан</th>
                  <th className="pb-2 text-left">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="align-top">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-slate-100">
                        {ticket.buyer_name}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
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
                          <span className="text-slate-600">-</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-200">
                      {ticket.quantity}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                      {fmtPrice(ticket.unit_price_cents, ticket.currency)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-slate-100">
                      {fmtPrice(ticket.quantity * ticket.unit_price_cents, ticket.currency)}
                    </td>
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
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
      </PanelCard>
    </div>
  );
}
