import { getTenantWithModules, listModules } from "@/lib/admin-queries";
import { notFound } from "next/navigation";
import UpdateTenantForm from "./update-tenant-form";
import TenantControls from "./tenant-controls";

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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
        <p className="mt-1 font-mono text-sm text-gray-500">{tenant.slug}</p>
      </div>

      {/* Edit tenant form */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Edit tenant</h2>
        <UpdateTenantForm tenant={tenant} />
      </section>

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
