import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { tenantHasModule } from "@/lib/modules";
import { getAvailabilitySlots } from "@/lib/reservation-queries";
import { getPublicFloorPlans } from "@/lib/floor-queries";
import { createClient } from "@/lib/supabase/server";
import type { ReservationSettings } from "@/lib/types/database";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

interface ReservePageProps {
  params: { slug: string };
  searchParams: {
    date?: string;
    party?: string;
    table?: string;
  };
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

/** Returns today's date in YYYY-MM-DD format (UTC calendar day). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns true when the string is a valid YYYY-MM-DD date. */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function ReservePage({
  params,
  searchParams,
}: ReservePageProps) {
  const tenant = await requireTenant(params.slug);

  const reservationsEnabled = await tenantHasModule(
    tenant.id,
    "reservations"
  );
  if (!reservationsEnabled) {
    notFound();
  }

  // --- Parse search params ---
  const today = todayISO();

  const rawDate = searchParams.date ?? "";
  const date = isValidDate(rawDate) && rawDate >= today ? rawDate : today;

  // Fetch reservation_settings to clamp party size.
  const supabase = createClient();
  const { data: settingsData } = await supabase
    .from("reservation_settings")
    .select("max_party_size")
    .eq("tenant_id", tenant.id)
    .single();

  const settings = settingsData as Pick<ReservationSettings, "max_party_size"> | null;
  const maxParty = settings?.max_party_size ?? 20;

  const rawParty = parseInt(searchParams.party ?? "2", 10);
  const party = isNaN(rawParty)
    ? 2
    : Math.max(1, Math.min(rawParty, maxParty));

  const preselectedTableId = searchParams.table ?? null;

  // --- Load availability and floor plans ---
  const [slots, plans] = await Promise.all([
    getAvailabilitySlots(tenant.id, date, party),
    getPublicFloorPlans(tenant.id),
  ]);

  return (
    <div
      className="font-body min-h-screen"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Page heading */}
        <h1
          className="font-heading text-3xl font-bold mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Reserve a Table
        </h1>
        <p
          className="text-sm mb-10"
          style={{ color: "var(--color-primary)", opacity: 0.6 }}
        >
          {tenant.name}
        </p>

        {/* ── Filter form (plain GET — no JS required) ───────────────── */}
        <section
          className="rounded-xl border p-6 mb-8"
          style={{
            borderColor: "rgba(0,0,0,0.10)",
            backgroundColor: "rgba(0,0,0,0.03)",
          }}
          aria-label="Search availability"
        >
          <h2
            className="font-heading text-lg font-semibold mb-4"
            style={{ color: "var(--color-primary)" }}
          >
            Find available times
          </h2>

          {/*
            action="" keeps us on the current path (same page) when submitted.
            method="get" serialises inputs as query params — no JS needed.
          */}
          <form
            method="get"
            action=""
            className="flex flex-wrap gap-4 items-end"
          >
            {/* Date */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="date-input"
                className="text-sm font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                Date
              </label>
              <input
                id="date-input"
                type="date"
                name="date"
                defaultValue={date}
                min={today}
                required
                className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  borderColor: "rgba(0,0,0,0.18)",
                  color: "var(--color-primary)",
                  backgroundColor: "var(--color-secondary)",
                  accentColor: "var(--color-accent)",
                }}
              />
            </div>

            {/* Party size */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="party-input"
                className="text-sm font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                Party size
              </label>
              <select
                id="party-input"
                name="party"
                defaultValue={String(party)}
                className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  borderColor: "rgba(0,0,0,0.18)",
                  color: "var(--color-primary)",
                  backgroundColor: "var(--color-secondary)",
                  accentColor: "var(--color-accent)",
                }}
              >
                {Array.from({ length: maxParty }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "guest" : "guests"}
                    </option>
                  )
                )}
              </select>
            </div>

            <button
              type="submit"
              className="rounded-lg px-5 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: "var(--color-accent)",
              }}
            >
              Check availability
            </button>
          </form>
        </section>

        {/* ── Booking form (client island) ───────────────────────────── */}
        {slots.length === 0 ? (
          <p
            className="text-base text-center py-12"
            style={{ color: "var(--color-primary)", opacity: 0.6 }}
          >
            No availability found for{" "}
            <strong>
              {date} · {party} {party === 1 ? "guest" : "guests"}
            </strong>
            . Try a different date or party size.
          </p>
        ) : (
          <BookingForm
            tenantId={tenant.id}
            slots={slots}
            plans={plans}
            defaultParty={party}
            preselectedTableId={preselectedTableId}
          />
        )}
      </div>
    </div>
  );
}
