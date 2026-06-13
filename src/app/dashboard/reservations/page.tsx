import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getReservationsForDashboard,
  getAvailabilityRulesForDashboard,
  getReservationSettingsForDashboard,
  getTablesForTenant,
} from "@/lib/reservation-queries";
import type { Reservation, ReservationStatus } from "@/lib/types/database";
import { StatusActions } from "./status-actions";
import { AvailabilityForm } from "./availability-form";
import { SettingsForm } from "./settings-form";
import { PageHeader, PanelCard, StatCard, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

/**
 * Returns today's date in YYYY-MM-DD UTC format.
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the Monday of the ISO week containing `dateISO` (UTC calendar).
 */
function mondayOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  // getUTCDay(): 0=Sun, 1=Mon … 6=Sat
  const day = d.getUTCDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diffToMon);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns a date string offset by `deltaDays` from `dateISO`.
 */
function offsetDate(dateISO: string, deltaDays: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Formats an ISO UTC timestamptz as "HH:MM UTC".
 */
function fmtTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/**
 * Formats a YYYY-MM-DD string as a short human-readable date (e.g. "ср, 12 июн").
 */
function fmtDate(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return d.toLocaleDateString("ru-RU", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<ReservationStatus, "amber" | "emerald" | "rose" | "sky" | "slate"> = {
  pending:   "amber",
  confirmed: "emerald",
  cancelled: "slate",
  completed: "sky",
  no_show:   "rose",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending:   "Ожидает",
  confirmed: "Подтверждено",
  cancelled: "Отменено",
  completed: "Завершено",
  no_show:   "Не пришли",
};

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

interface SummaryCounts {
  pending:   number;
  confirmed: number;
  cancelled: number;
  completed: number;
  no_show:   number;
}

function countByStatus(reservations: Reservation[]): SummaryCounts {
  const counts: SummaryCounts = { pending: 0, confirmed: 0, cancelled: 0, completed: 0, no_show: 0 };
  for (const r of reservations) {
    counts[r.status]++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Reservation row
// ---------------------------------------------------------------------------

function ReservationRow({
  reservation,
  tableLabel,
}: {
  reservation: Reservation;
  tableLabel: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        {/* Time */}
        <span className="w-24 shrink-0 text-sm font-semibold text-slate-100 tabular-nums">
          {fmtTime(reservation.starts_at)}
        </span>

        {/* Guest name + party */}
        <span className="flex-1 min-w-0 text-sm font-medium text-slate-100 truncate">
          {reservation.guest_name}
          <span className="ml-1.5 text-slate-400 font-normal">
            × {reservation.party_size}
          </span>
        </span>

        {/* Status badge */}
        <Badge tone={STATUS_TONE[reservation.status]}>
          {STATUS_LABEL[reservation.status]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Table */}
        {tableLabel && (
          <span className="text-xs text-slate-500">
            Стол{" "}
            <span className="font-medium text-slate-300">{tableLabel}</span>
          </span>
        )}

        {/* Contact */}
        {reservation.guest_email && (
          <span className="text-xs text-slate-500 truncate max-w-[180px]">
            {reservation.guest_email}
          </span>
        )}
        {reservation.guest_phone && (
          <span className="text-xs text-slate-500">{reservation.guest_phone}</span>
        )}

        {/* Notes */}
        {reservation.notes && (
          <span className="text-xs text-slate-600 truncate max-w-xs">
            {reservation.notes}
          </span>
        )}
      </div>

      {/* Status actions */}
      <div className="pt-0.5">
        <StatusActions
          reservationId={reservation.id}
          currentStatus={reservation.status}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day section (used in week view)
// ---------------------------------------------------------------------------

function DaySection({
  dateISO,
  reservations,
  tableMap,
}: {
  dateISO: string;
  reservations: Reservation[];
  tableMap: Map<string, string>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide pt-2">
        {fmtDate(dateISO)}
        <span className="ml-2 text-slate-500 font-normal normal-case text-xs">
          ({reservations.length} {reservations.length === 1 ? "бронь" : "брони"})
        </span>
      </h3>
      {reservations.length === 0 ? (
        <p className="text-xs text-slate-600 pl-1">Нет броней.</p>
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => (
            <ReservationRow
              key={r.id}
              reservation={r}
              tableLabel={r.floor_table_id ? (tableMap.get(r.floor_table_id) ?? null) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ReservationsPageProps {
  searchParams: Promise<{ date?: string; view?: string }>;
}

export default async function ReservationsPage({ searchParams }: ReservationsPageProps) {
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

  // ── Parse searchParams ───────────────────────────────────────────────────
  const resolvedParams = await searchParams;
  const rawDate = resolvedParams.date;
  const rawView = resolvedParams.view;

  const view: "day" | "week" = rawView === "week" ? "week" : "day";

  // Validate date string or fall back to today (UTC).
  const today = todayUTC();
  const isValidDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  const selectedDate = isValidDate ? rawDate : today;

  // ── Compute range ────────────────────────────────────────────────────────
  let fromISO: string;
  let toISO: string;
  const weekDates: string[] = []; // only populated in week view

  if (view === "week") {
    const monday = mondayOfWeek(selectedDate);
    fromISO = `${monday}T00:00:00.000Z`;
    toISO   = `${offsetDate(monday, 7)}T00:00:00.000Z`;
    for (let i = 0; i < 7; i++) {
      weekDates.push(offsetDate(monday, i));
    }
  } else {
    fromISO = `${selectedDate}T00:00:00.000Z`;
    toISO   = `${offsetDate(selectedDate, 1)}T00:00:00.000Z`;
  }

  // ── Load data in parallel ────────────────────────────────────────────────
  const [reservations, tables, rules, settings] = await Promise.all([
    getReservationsForDashboard(tenantId, fromISO, toISO),
    getTablesForTenant(tenantId),
    getAvailabilityRulesForDashboard(tenantId),
    getReservationSettingsForDashboard(tenantId),
  ]);

  const tableMap = new Map(tables.map((t) => [t.id, t.label]));

  // ── Status summary counts ────────────────────────────────────────────────
  const counts = countByStatus(reservations);

  // ── Navigation dates ─────────────────────────────────────────────────────
  const prevDate = view === "week"
    ? offsetDate(mondayOfWeek(selectedDate), -7)
    : offsetDate(selectedDate, -1);
  const nextDate = view === "week"
    ? offsetDate(mondayOfWeek(selectedDate), 7)
    : offsetDate(selectedDate, 1);

  const prevHref  = `/dashboard/reservations?date=${prevDate}&view=${view}`;
  const nextHref  = `/dashboard/reservations?date=${nextDate}&view=${view}`;
  const todayHref = `/dashboard/reservations?date=${today}&view=${view}`;
  const dayHref   = `/dashboard/reservations?date=${selectedDate}&view=day`;
  const weekHref  = `/dashboard/reservations?date=${selectedDate}&view=week`;

  // Heading label
  const headingLabel = view === "week"
    ? `Неделя с ${fmtDate(mondayOfWeek(selectedDate))}`
    : fmtDate(selectedDate);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Бронирование"
        title="Бронирование"
        description="Управляйте бронями и настройками доступности. Всё время указано в UTC."
      />

      {/* ── Date navigation ───────────────────────────────────────────────── */}
      <div className="glass px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Prev / Next */}
          <div className="flex gap-1">
            <Link href={prevHref} className="btn-secondary">
              &larr; {view === "week" ? "Пред. неделя" : "Пред. день"}
            </Link>
            <Link href={todayHref} className="btn-secondary">
              Сегодня
            </Link>
            <Link href={nextHref} className="btn-secondary">
              {view === "week" ? "След. неделя" : "След. день"} &rarr;
            </Link>
          </div>

          {/* Heading */}
          <span className="flex-1 text-center text-sm font-semibold text-slate-200">
            {headingLabel}
          </span>

          {/* View toggle */}
          <div className="flex gap-1">
            <Link
              href={dayHref}
              className={view === "day" ? "btn-primary" : "btn-secondary"}
            >
              День
            </Link>
            <Link
              href={weekHref}
              className={view === "week" ? "btn-primary" : "btn-secondary"}
            >
              Неделя
            </Link>
          </div>
        </div>
      </div>

      {/* ── Status summary ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["pending",   counts.pending],
            ["confirmed", counts.confirmed],
            ["cancelled", counts.cancelled],
            ["completed", counts.completed],
            ["no_show",   counts.no_show],
          ] as const
        ).map(([status, count]) => (
          <StatCard
            key={status}
            stat={count}
            label={STATUS_LABEL[status as ReservationStatus]}
          />
        ))}
      </div>

      {/* ── Reservations list ─────────────────────────────────────────────── */}
      <PanelCard
        title={
          <>
            Брони -{" "}
            <span className="font-normal text-slate-400">{headingLabel}</span>
          </>
        }
      >
        {reservations.length === 0 && (
          <p className="text-sm text-slate-500">
            Нет броней за этот период.
          </p>
        )}

        {view === "day" && reservations.length > 0 && (
          <div className="space-y-2">
            {reservations.map((r) => (
              <ReservationRow
                key={r.id}
                reservation={r}
                tableLabel={r.floor_table_id ? (tableMap.get(r.floor_table_id) ?? null) : null}
              />
            ))}
          </div>
        )}

        {view === "week" && (
          <div className="space-y-6">
            {weekDates.map((dateISO) => {
              const dayReservations = reservations.filter((r) =>
                r.starts_at.startsWith(dateISO)
              );
              return (
                <DaySection
                  key={dateISO}
                  dateISO={dateISO}
                  reservations={dayReservations}
                  tableMap={tableMap}
                />
              );
            })}
          </div>
        )}
      </PanelCard>

      {/* ── Availability settings ─────────────────────────────────────────── */}
      <PanelCard
        title="Часы работы по дням"
        description="Настройте, в какие дни и часы гости могут бронировать. Всё время в UTC."
      >
        <AvailabilityForm rules={rules} />
      </PanelCard>

      {/* ── Reservation settings ──────────────────────────────────────────── */}
      <PanelCard
        title="Настройки бронирования"
        description="Управляйте лимитами по числу гостей, окнами заблаговременной брони и длительностью по умолчанию."
      >
        <SettingsForm settings={settings} />
      </PanelCard>
    </div>
  );
}
