import { listModules } from "@/lib/admin-queries";
import ModuleControls from "./module-controls";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { IconModules } from "@/components/icons";

export const dynamic = "force-dynamic";

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function ModulesPage() {
  const modules = await listModules();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Каталог"
        title="Модули"
        description={`Каталог модулей платформы - ${modules.length} ${
          modules.length === 1 ? "модуль" : "модулей"
        }.`}
      />

      {modules.length === 0 ? (
        <EmptyState
          icon={<IconModules />}
          title="Модулей пока нет"
          description="В каталоге платформы ещё не настроено ни одного модуля."
        />
      ) : (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5">
              <thead>
                <tr className="border-b border-white/10">
                  {["ID", "Название", "Период оплаты", "Базовая цена", "Активен", "Изменить цену"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {modules.map((mod) => (
                  <tr key={mod.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-sm text-slate-200">
                      {mod.id}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-200">{mod.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {mod.billing_period}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-200">
                      {centsToDisplay(mod.base_price_cents)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={mod.is_active ? "emerald" : "slate"}>
                        {mod.is_active ? "активен" : "неактивен"}
                      </Badge>
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
      )}
    </div>
  );
}
