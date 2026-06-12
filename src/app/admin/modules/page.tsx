import { listModules } from "@/lib/admin-queries";
import ModuleControls from "./module-controls";

export const dynamic = "force-dynamic";

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function ModulesPage() {
  const modules = await listModules();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Modules</h1>
        <p className="mt-1 text-sm text-gray-500">
          Platform module catalog — {modules.length} module{modules.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["ID", "Name", "Billing period", "Base price", "Active", "Edit base price"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {modules.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                  No modules yet.
                </td>
              </tr>
            )}
            {modules.map((mod) => (
              <tr key={mod.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm text-gray-900">
                  {mod.id}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{mod.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {mod.billing_period}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {centsToDisplay(mod.base_price_cents)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      mod.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {mod.is_active ? "active" : "inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ModuleControls
                    moduleId={mod.id}
                    currentBasePriceCents={mod.base_price_cents}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
