import { getProfile } from "@/lib/auth";
import { getFloorPlansForDashboard } from "@/lib/floor-queries";
import { redirect } from "next/navigation";
import { FloorPlanForms } from "./floor-plan-forms";
import { FloorPhotoUploader } from "./floor-photo-uploader";
import { ZoneEditor } from "./zone-editor";
import { PageHeader, PanelCard, Card, EmptyState, Badge } from "@/components/ui";
import { IconFloor } from "@/components/icons";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function FloorPage() {
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
  const plans = await getFloorPlansForDashboard(tenantId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Схема зала"
        title="Схема зала"
        description="Загрузите фото вашего зала, затем нарисуйте зоны столов поверх него."
      />

      {/* Create floor plan */}
      <PanelCard title="Добавить схему зала">
        <FloorPlanForms.Create />
      </PanelCard>

      {/* No plans yet */}
      {plans.length === 0 && (
        <EmptyState
          icon={<IconFloor className="h-6 w-6" />}
          title="Пока нет ни одной схемы"
          description="Добавьте схему выше, чтобы начать."
        />
      )}

      {/* Per-plan editor sections */}
      {plans.map((plan) => (
        <Card key={plan.id} padded={false} className="overflow-hidden">
          {/* Plan header */}
          <div className="border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-100">
                {plan.name}
              </h2>
              <span className="text-xs text-slate-500">
                {plan.width}&times;{plan.height}
              </span>
              {!plan.is_active && <Badge tone="slate">Неактивна</Badge>}
            </div>
          </div>

          {/* Edit plan settings */}
          <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Настройки схемы
            </p>
            <FloorPlanForms.Edit plan={plan} />
          </div>

          {/* Photo uploader */}
          <div className="border-b border-white/10 px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Фон-подложка
            </p>
            <FloorPhotoUploader
              tenantId={tenantId}
              planId={plan.id}
              currentImageUrl={plan.image_url}
            />
          </div>

          {/* Zone editor */}
          <div className="px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Зоны столов
            </p>
            <ZoneEditor plan={plan} tables={plan.tables} />
          </div>
        </Card>
      ))}
    </div>
  );
}
