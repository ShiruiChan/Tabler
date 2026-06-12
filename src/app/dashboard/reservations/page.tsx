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
 * Formats a YYYY-MM-DD string as a short human-readable date (e.g. "Wed Jun 12").
 */
function fmtDate(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<ReservationStatus, string> = {
  pending:   "bg-amber-100 text-amber-800",
  confirmed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  completed: "bg-blue-100 text-blue-800",
  no_show:   "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending:   "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show:   "No-show",
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
    <div className="grid grid-cols-1 gap-y-2 rounded-md border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        {/* Time */}
        <span className="w-24 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
          {fmtTime(reservation.starts_at)}
        </span>

        {/* Guest name + party */}
        <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
          {reservation.guest_name}
          <span className="ml-1.5 text-gray-500 font-normal">
            × {reservation.party_size}
          </span>
        </span>

        {/* Status badge */}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[reservation.status]}`}
        >
          {STATUS_LABEL[reservation.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Table */}
        {tableLabel && (
          <span className="text-xs text-gray-500">
            Table{" "}
            <span className="font-medium text-gray-700">{tableLabel}</span>
          </span>
        )}

        {/* Contact */}
        {reservation.guest_email && (
          <span className="text-xs text-gray-500 truncate max-w-[180px]">
            {reservation.guest_email}
          </span>
        )}
        {reservation.guest_phone && (
          <span className="text-xs text-gray-500">{reservation.guest_phone}</span>
        )}

        {/* Notes */}
        {reservation.notes && (
          <span className="text-xs text-gray-400 truncate max-w-xs">
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
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide pt-2">
        {fmtDate(dateISO)}
        <span className="ml-2 text-gray-400 font-normal normal-case text-xs">
          ({reservations.length} booking{reservations.length !== 1 ? "s" : ""})
        </span>
      </h3>
      {reservations.length === 0 ? (
        <p className="text-xs text-gray-400 pl-1">No reservations.</p>
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
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5">
        <p className="text-sm text-red-700">
          Your account is not associated with a restaurant. Contact support.
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
    ? `Week of ${fmtDate(mondayOfWeek(selectedDate))}`
    : fmtDate(selectedDate);

  return (
    <div className="space-y-8">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage bookings and availability settings. All times are UTC.
        </p>
      </div>

      {/* ── Date navigation ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Prev / Next */}
          <div className="flex gap-1">
            <Link
              href={prevHref}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              &larr; {view === "week" ? "Prev week" : "Prev day"}
            </Link>
            <Link
              href={todayHref}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Today
            </Link>
            <Link
              href={nextHref}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              {view === "week" ? "Next week" : "Next day"} &rarr;
            </Link>
          </div>

          {/* Heading */}
          <span className="flex-1 text-center text-sm font-semibold text-gray-800">
            {headingLabel}
          </span>

          {/* View toggle */}
          <div className="flex gap-1">
            <Link
              href={dayHref}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === "day"
                  ? "bg-gray-900 text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Day
            </Link>
            <Link
              href={weekHref}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === "week"
                  ? "bg-gray-900 text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Week
            </Link>
          </div>
        </div>
      </section>

      {/* ── Status summary ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["pending",   counts.pending,   "bg-amber-50  text-amber-800  border-amber-200"],
            ["confirmed", counts.confirmed, "bg-green-50  text-green-800  border-green-200"],
            ["cancelled", counts.cancelled, "bg-gray-50   text-gray-600   border-gray-200"],
            ["completed", counts.completed, "bg-blue-50   text-blue-800   border-blue-200"],
            ["no_show",   counts.no_show,   "bg-red-50    text-red-700    border-red-200"],
          ] as const
        ).map(([status, count, cls]) => (
          <div
            key={status}
            className={`rounded-lg border px-4 py-3 text-center ${cls}`}
          >
            <div className="text-xl font-bold tabular-nums">{count}</div>
            <div className="text-xs font-medium capitalize mt-0.5">
              {STATUS_LABEL[status as ReservationStatus]}
            </div>
          </div>
        ))}
      </div>

      {/* ── Reservations list ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Bookings —{" "}
          <span className="font-normal text-gray-500">{headingLabel}</span>
        </h2>

        {reservations.length === 0 && (
          <p className="text-sm text-gray-400">
            No reservations for this period.
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
      </section>

      {/* ── Availability settings ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          Weekly availability
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Configure which days and hours guests may book. All times are UTC.
        </p>
        <AvailabilityForm rules={rules} />
      </section>

      {/* ── Reservation settings ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          Booking settings
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Control party size limits, advance booking windows, and default duration.
        </p>
        <SettingsForm settings={settings} />
      </section>
    </div>
  );
}
