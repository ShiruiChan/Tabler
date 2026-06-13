import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEventsForDashboard } from "@/lib/event-queries";
import { CreateEventForm } from "./event-forms";
import { EditEventForm } from "./event-forms";
import { EventImageUploader } from "./event-image-uploader";
import type { EventWithStats } from "@/lib/event-queries";
import { PageHeader, PanelCard, StatCard, Card, EmptyState, Badge } from "@/components/ui";
import { IconTicket, IconArrowRight } from "@/components/icons";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO UTC timestamptz as "DD Mon YYYY HH:MM UTC"
 */
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

/**
 * Format price_cents as a human-readable string.
 * price_cents = 0 → "Бесплатно"
 * otherwise → "$X.XX USD" (using currency symbol where known)
 */
function fmtPrice(cents: number, currency: string): string {
  if (cents === 0) return "Бесплатно";
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
    { label: "Всего событий",   value: String(totalEvents) },
    { label: "Опубликовано",    value: String(publishedEvents) },
    { label: "Продано билетов", value: String(totalSold) },
    { label: "Выручка (оплачено)", value: `$${(totalRevenue / 100).toFixed(2)}` },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(({ label, value }) => (
        <StatCard key={label} stat={value} label={label} />
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
    <Card padded={false} className="overflow-hidden">
      {/* Card header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <h2 className="flex-1 min-w-0 text-base font-semibold text-slate-100 truncate">
            {event.title}
          </h2>
          {event.is_published ? (
            <Badge tone="emerald">Опубликовано</Badge>
          ) : (
            <Badge tone="slate">Черновик</Badge>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>
            <span className="font-medium text-slate-300">{fmtDatetime(event.starts_at)}</span>
          </span>
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
            Цена:{" "}
            <span className="font-medium text-slate-300">
              {fmtPrice(event.price_cents, event.currency)}
            </span>
          </span>
          <span>
            Выручка (оплачено):{" "}
            <span className="font-medium text-slate-300">
              {fmtPrice(event.revenue_cents, event.currency)}
            </span>
          </span>
        </div>
      </div>

      {/* Event image uploader */}
      <div className="border-b border-white/10 px-6 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Изображение события
        </p>
        <EventImageUploader
          tenantId={tenantId}
          eventId={event.id}
          currentImageUrl={event.image_url}
        />
      </div>

      {/* Edit form */}
      <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Редактировать событие
        </p>
        <EditEventForm event={event} />
      </div>

      {/* Attendees link */}
      <div className="px-6 py-4">
        <Link
          href={`/dashboard/events/${event.id}`}
          className="btn-secondary"
        >
          Посмотреть участников
          <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
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
      <div className="alert-error">
        <p>
          Ваш аккаунт не привязан к ресторану. Обратитесь в поддержку.
        </p>
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const events = await getEventsForDashboard(tenantId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="События"
        title="События"
        description="Управляйте билетными событиями и продажами. Всё время указано в UTC."
      />

      {/* Summary cards */}
      <SummaryCards events={events} />

      {/* Create event */}
      <PanelCard title="Добавить событие">
        <CreateEventForm />
      </PanelCard>

      {/* Events list */}
      {events.length === 0 ? (
        <EmptyState
          icon={<IconTicket className="h-6 w-6" />}
          title="Пока нет ни одного события"
          description="Создайте событие выше, чтобы начать."
        />
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
