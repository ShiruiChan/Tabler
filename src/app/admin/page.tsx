import { listTenants } from "@/lib/admin-queries";
import { listModules } from "@/lib/admin-queries";
import { PageHeader, StatCard } from "@/components/ui";
import { IconTenants, IconModules, IconOverview } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function SuperAdminDashboard() {
  const [tenants, modules] = await Promise.all([listTenants(), listModules()]);

  const total = tenants.length;
  const active = tenants.filter((t) => t.status === "active").length;
  const suspended = tenants.filter((t) => t.status === "suspended").length;
  const pending = tenants.filter((t) => t.status === "pending").length;

  const cards = [
    { label: "Всего ресторанов", value: total, icon: <IconTenants /> },
    { label: "Активные", value: active, icon: <IconOverview /> },
    { label: "Приостановлены", value: suspended, icon: <IconOverview /> },
    { label: "Ожидают", value: pending, icon: <IconOverview /> },
    { label: "Модули", value: modules.length, icon: <IconModules /> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Консоль платформы"
        title="Обзор"
        description="Сводка по ресторанам и модулям платформы Tabler."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            stat={card.value}
            label={card.label}
            icon={card.icon}
          />
        ))}
      </div>
    </div>
  );
}
