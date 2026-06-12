import { getProfile } from "@/lib/auth";
import { getFloorPlansForDashboard } from "@/lib/floor-queries";
import { redirect } from "next/navigation";
import { FloorPlanForms } from "./floor-plan-forms";
import { FloorPhotoUploader } from "./floor-photo-uploader";
import { ZoneEditor } from "./zone-editor";

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
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5">
        <p className="text-sm text-red-700">
          Your account is not associated with a restaurant. Contact support.
        </p>
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const plans = await getFloorPlansForDashboard(tenantId);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Floor plan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a photo of your floor, then draw table zones on it.
        </p>
      </div>

      {/* Create floor plan */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Add floor plan
        </h2>
        <FloorPlanForms.Create />
      </section>

      {/* No plans yet */}
      {plans.length === 0 && (
        <p className="text-sm text-gray-500">
          No floor plans yet. Add one above to get started.
        </p>
      )}

      {/* Per-plan editor sections */}
      {plans.map((plan) => (
        <section
          key={plan.id}
          className="rounded-lg border border-gray-200 bg-white"
        >
          {/* Plan header */}
          <div className="border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                {plan.name}
              </h2>
              <span className="text-xs text-gray-400">
                {plan.width}&times;{plan.height}
              </span>
              {!plan.is_active && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                  Inactive
                </span>
              )}
            </div>
          </div>

          {/* Edit plan settings */}
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Plan settings
            </p>
            <FloorPlanForms.Edit plan={plan} />
          </div>

          {/* Photo uploader */}
          <div className="border-b border-gray-100 px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Background photo
            </p>
            <FloorPhotoUploader
              tenantId={tenantId}
              planId={plan.id}
              currentImageUrl={plan.image_url}
            />
          </div>

          {/* Zone editor */}
          <div className="px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Table zones
            </p>
            <ZoneEditor plan={plan} tables={plan.tables} />
          </div>
        </section>
      ))}
    </div>
  );
}
