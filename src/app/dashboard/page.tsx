import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Dashboard overview page.
 *
 * Auth is handled by the parent layout (requireRole), so this page only
 * fetches the data it needs to display tenant info.
 */
export default async function DashboardPage() {
  const profile = await getProfile();

  let tenantName: string | null = null;
  let tenantSlug: string | null = null;
  let tenantStatus: string | null = null;

  if (profile?.tenant_id) {
    const supabase = createClient();
    const { data } = await supabase
      .from("tenants")
      .select("name, slug, status")
      .eq("id", profile.tenant_id)
      .single();
    tenantName = data?.name ?? null;
    tenantSlug = data?.slug ?? null;
    tenantStatus = data?.status ?? null;
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const publicSiteUrl = tenantSlug
    ? `https://${tenantSlug}.${rootDomain}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {tenantName ?? "Restaurant Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}. Manage
          your restaurant&apos;s online presence from here.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900">
            Restaurant overview
          </h2>
        </div>
        <dl className="divide-y divide-gray-100">
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <dt className="text-sm font-medium text-gray-500">Name</dt>
            <dd className="col-span-2 text-sm text-gray-900">
              {tenantName ?? "—"}
            </dd>
          </div>
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <dt className="text-sm font-medium text-gray-500">Status</dt>
            <dd className="col-span-2 text-sm text-gray-900">
              {tenantStatus ? (
                <span
                  className={
                    tenantStatus === "active"
                      ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                      : "inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700"
                  }
                >
                  {tenantStatus}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="grid grid-cols-3 gap-4 px-6 py-4">
            <dt className="text-sm font-medium text-gray-500">Slug URL</dt>
            <dd className="col-span-2 text-sm text-gray-900">
              {publicSiteUrl ? (
                <a
                  href={publicSiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  {publicSiteUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex gap-3">
        <Link
          href="/dashboard/design"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Edit site design
        </Link>
      </div>
    </div>
  );
}
