import { listTenants } from "@/lib/admin-queries";
import Link from "next/link";
import NewTenantForm from "./new-tenant-form";
import type { TenantStatus } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: TenantStatus }) {
  const classes: Record<TenantStatus, string> = {
    active: "bg-green-100 text-green-800",
    suspended: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[status]}`}
    >
      {status}
    </span>
  );
}

export default async function TenantsPage() {
  const tenants = await listTenants();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
        <p className="mt-1 text-sm text-gray-500">{tenants.length} total</p>
      </div>

      {/* Tenant table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Slug", "Name", "Status", "Custom domain", "Created"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                  No tenants yet.
                </td>
              </tr>
            )}
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono text-gray-900">
                  <Link
                    href={`/admin/tenants/${tenant.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {tenant.slug}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{tenant.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={tenant.status} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {tenant.custom_domain ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(tenant.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New tenant form */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">New tenant</h2>
        <NewTenantForm />
      </div>
    </div>
  );
}
