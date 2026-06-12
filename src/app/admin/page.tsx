import { listTenants } from "@/lib/admin-queries";
import { listModules } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

export default async function SuperAdminDashboard() {
  const [tenants, modules] = await Promise.all([listTenants(), listModules()]);

  const total = tenants.length;
  const active = tenants.filter((t) => t.status === "active").length;
  const suspended = tenants.filter((t) => t.status === "suspended").length;
  const pending = tenants.filter((t) => t.status === "pending").length;

  const cards = [
    { label: "Total tenants", value: total },
    { label: "Active", value: active },
    { label: "Suspended", value: suspended },
    { label: "Pending", value: pending },
    { label: "Modules", value: modules.length },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Platform overview</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-gray-200 bg-white px-5 py-4"
          >
            <p className="text-xs font-medium text-gray-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
