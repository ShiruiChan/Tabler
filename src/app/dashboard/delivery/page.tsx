import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getDeliverySettings } from "@/lib/delivery-queries";
import { getDeliveryZones } from "@/lib/delivery-queries";
import { DeliverySettingsForm } from "./settings-form";
import { CreateZoneForm, EditZoneForm } from "./zone-forms";
import type { DeliveryZone } from "@/lib/types/database";
import { PageHeader, PanelCard, Card, EmptyState, Badge } from "@/components/ui";
import { IconDelivery } from "@/components/icons";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a cents value as a human-readable string.
 * null → "-"
 * 0    → "Бесплатно"
 * otherwise → "$X.XX" (using currency symbol where known)
 */
function fmtCents(cents: number | null, currency?: string): string {
  if (cents === null) return "-";
  if (cents === 0) return "Бесплатно";
  const symbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", rub: "₽" };
  const sym = currency ? (symbols[currency] ?? currency.toUpperCase() + " ") : "$";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Zone card (server component - edit form is client)
// ---------------------------------------------------------------------------

interface ZoneCardProps {
  zone: DeliveryZone;
  currency: string;
}

function ZoneCard({ zone, currency }: ZoneCardProps) {
  return (
    <Card padded={false} className="overflow-hidden">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-4">
        <h3 className="flex-1 min-w-0 text-base font-semibold text-slate-100 truncate">
          {zone.name}
        </h3>
        {zone.is_active ? (
          <Badge tone="emerald">Активна</Badge>
        ) : (
          <Badge tone="slate">Неактивна</Badge>
        )}
        <span className="text-xs text-slate-500">Порядок: {zone.sort_order}</span>
      </div>

      {/* Stats */}
      <div className="border-b border-white/10 px-6 py-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>
            Стоимость:{" "}
            <span className="font-medium text-slate-300">
              {zone.fee_override_cents != null
                ? fmtCents(zone.fee_override_cents, currency)
                : "Базовая стоимость"}
            </span>
          </span>
          <span>
            Мин. заказ:{" "}
            <span className="font-medium text-slate-300">
              {zone.min_order_override_cents != null
                ? fmtCents(zone.min_order_override_cents, currency)
                : "Общий минимум"}
            </span>
          </span>
          {zone.polygon && (
            <span>
              Полигон:{" "}
              <span className="font-medium text-slate-300">
                {zone.polygon.length} точек
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white/[0.02] px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Редактировать зону
        </p>
        <EditZoneForm zone={zone} />
      </div>
    </Card>
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
      <div className="alert-error">
        <p>
          Ваш аккаунт не привязан к ресторану. Обратитесь в поддержку.
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
      <div className="glass border-amber-400/20 bg-amber-400/[0.06] px-6 py-5">
        <p className="text-sm text-amber-200">
          Настройки доставки не были инициализированы для этого ресторана.
          Обратитесь в поддержку или пересохраните профиль ресторана, чтобы
          запустить настройку.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Доставка"
        title="Доставка"
        description="Настройте параметры доставки, цены и зоны. Всё время указано в UTC."
      />

      {/* Settings card */}
      <PanelCard title="Настройки доставки">
        <DeliverySettingsForm settings={settings} />
      </PanelCard>

      {/* Zones section */}
      <div>
        <h2 className="mb-2 text-lg font-semibold text-slate-100">
          Зоны доставки
        </h2>
        <p className="mb-4 text-sm text-slate-400">
          Определите именованные зоны с необязательными переопределениями
          стоимости и минимального заказа. Зоны без полигона - это именованные
          области без границы на карте.
        </p>

        {/* Create zone */}
        <div className="mb-6">
          <CreateZoneForm />
        </div>

        {/* Zone list */}
        {zones.length === 0 ? (
          <EmptyState
            icon={<IconDelivery className="h-6 w-6" />}
            title="Пока нет ни одной зоны"
            description="Создайте зону выше, чтобы начать."
          />
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
