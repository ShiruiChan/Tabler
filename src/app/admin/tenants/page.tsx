import { listTenants } from "@/lib/admin-queries";
import Link from "next/link";
import NewTenantForm from "./new-tenant-form";
import type { TenantStatus } from "@/lib/types/database";
import { PageHeader, Badge, PanelCard, EmptyState } from "@/components/ui";
import { IconTenants } from "@/components/icons";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<TenantStatus, "emerald" | "rose" | "amber"> = {
  active: "emerald",
  suspended: "rose",
  pending: "amber",
};

const STATUS_LABEL: Record<TenantStatus, string> = {
  active: "активен",
  suspended: "приостановлен",
  pending: "ожидает",
};

function StatusBadge({ status }: { status: TenantStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export default async function TenantsPage() {
  const tenants = await listTenants();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Платформа"
        title="Рестораны"
        description={`Всего: ${tenants.length}.`}
      />

      {/* Tenant table */}
      {tenants.length === 0 ? (
        <EmptyState
          icon={<IconTenants />}
          title="Ресторанов пока нет"
          description="Создайте первый ресторан с помощью формы ниже."
        />
      ) : (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5">
              <thead>
                <tr className="border-b border-white/10">
                  {["Слаг", "Название", "Статус", "Свой домен", "Создан"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-sm font-mono">
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="text-amber-400 hover:text-amber-300 hover:underline"
                      >
                        {tenant.slug}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-200">{tenant.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {tenant.custom_domain ?? <span className="text-slate-600">-</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {new Date(tenant.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New tenant form */}
      <PanelCard
        title="Новый ресторан"
        description="Добавьте ресторан в платформу."
      >
        <NewTenantForm />
      </PanelCard>
    </div>
  );
}
