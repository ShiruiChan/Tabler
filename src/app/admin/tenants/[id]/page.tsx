import { getTenantWithModules, listModules } from "@/lib/admin-queries";
import { notFound } from "next/navigation";
import UpdateTenantForm from "./update-tenant-form";
import TenantControls from "./tenant-controls";
import { PageHeader, PanelCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [result, modules] = await Promise.all([
    getTenantWithModules(params.id),
    listModules(),
  ]);

  if (!result) notFound();

  const { tenant, modules: tenantModules } = result;

  // Build a name map from the platform module catalog so the UI can show
  // human-readable names alongside each TenantModulePricing entry.
  const moduleNameMap: Record<string, string> = {};
  for (const m of modules) {
    moduleNameMap[m.id] = m.name;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Ресторан"
        title={tenant.name}
        description={<span className="font-mono">{tenant.slug}</span>}
      />

      {/* Edit tenant form */}
      <PanelCard title="Редактировать ресторан" description="Измените название и домен ресторана.">
        <UpdateTenantForm tenant={tenant} />
      </PanelCard>

      {/* Status + module controls */}
      <TenantControls
        tenantId={tenant.id}
        currentStatus={tenant.status}
        modules={tenantModules}
        moduleNameMap={moduleNameMap}
      />
    </div>
  );
}
