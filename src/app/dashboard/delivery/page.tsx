import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getDeliverySettings } from "@/lib/delivery-queries";
import { getDeliveryZones } from "@/lib/delivery-queries";
import { DeliverySettingsForm } from "./settings-form";
import { CreateZoneForm, EditZoneForm } from "./zone-forms";
import type { DeliveryZone } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a cents value as a human-readable string.
 * null → "—"
 * 0    → "Free"
 * otherwise → "$X.XX" (using currency symbol where known)
 */
function fmtCents(cents: number | null, currency?: string): string {
  if (cents === null) return "—";
  if (cents === 0) return "Free";
  const symbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", rub: "₽" };
  const sym = currency ? (symbols[currency] ?? currency.toUpperCase() + " ") : "$";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Zone card (server component — edit form is client)
// ---------------------------------------------------------------------------

interface ZoneCardProps {
  zone: DeliveryZone;
  currency: string;
}

function ZoneCard({ zone, currency }: ZoneCardProps) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-6 py-4">
        <h3 className="flex-1 min-w-0 text-base font-semibold text-gray-900 truncate">
          {zone.name}
        </h3>
        {zone.is_active ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            Inactive
          </span>
        )}
        <span className="text-xs text-gray-400">Sort: {zone.sort_order}</span>
      </div>

      {/* Stats */}
      <div className="border-b border-gray-100 px-6 py-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
          <span>
            Fee:{" "}
            <span className="font-medium text-gray-700">
              {zone.fee_override_cents != null
                ? fmtCents(zone.fee_override_cents, currency)
                : "Use base fee"}
            </span>
          </span>
          <span>
            Min order:{" "}
            <span className="font-medium text-gray-700">
              {zone.min_order_override_cents != null
                ? fmtCents(zone.min_order_override_cents, currency)
                : "Use global minimum"}
            </span>
          </span>
          {zone.polygon && (
            <span>
              Polygon:{" "}
              <span className="font-medium text-gray-700">
                {zone.polygon.length} points
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-gray-50 px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Edit zone
        </p>
        <EditZoneForm zone={zone} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DeliveryPage() {
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

  const [settings, zones] = await Promise.all([
    getDeliverySettings(tenantId),
    getDeliveryZones(tenantId),
  ]);

  // settings should always exist (trigger auto-creates on tenant INSERT),
  // but handle the edge case gracefully.
  if (!settings) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-6 py-5">
        <p className="text-sm text-yellow-700">
          Delivery settings have not been initialised for this tenant. Contact
          support or re-save your restaurant profile to trigger setup.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delivery</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure delivery settings, pricing, and zones. All times are UTC.
        </p>
      </div>

      {/* Settings card */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Delivery settings
        </h2>
        <DeliverySettingsForm settings={settings} />
      </section>

      {/* Zones section */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Delivery zones
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Define named zones with optional fee and minimum-order overrides. Zones
          without a polygon are named areas without a map boundary.
        </p>

        {/* Create zone */}
        <div className="mb-6">
          <CreateZoneForm />
        </div>

        {/* Zone list */}
        {zones.length === 0 ? (
          <p className="text-sm text-gray-500">
            No zones yet. Create one above to get started.
          </p>
        ) : (
          <div className="space-y-4">
            {(zones as DeliveryZone[]).map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                currency={settings.currency}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
