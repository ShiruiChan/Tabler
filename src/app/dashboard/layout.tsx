import { requireRole } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("restaurant_owner", "restaurant_staff");

  // Fetch the tenant name to display in the sidebar.
  let tenantName: string | null = null;
  if (profile.tenant_id) {
    const supabase = createClient();
    const { data } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", profile.tenant_id)
      .single();
    tenantName = data?.name ?? null;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <span className="text-sm font-semibold text-gray-900">
            {tenantName ?? "Restaurant Dashboard"}
          </span>
          {profile.full_name && (
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {profile.full_name}
            </p>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <Link
            href="/dashboard"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Overview
          </Link>
          <Link
            href="/dashboard/design"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Site Design
          </Link>
          <Link
            href="/dashboard/menu"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Menu
          </Link>
          <Link
            href="/dashboard/floor"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Floor plan
          </Link>
          <Link
            href="/dashboard/reservations"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Reservations
          </Link>
          <Link
            href="/dashboard/events"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Events
          </Link>
          <Link
            href="/dashboard/delivery"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            Delivery
          </Link>
        </nav>

        <div className="border-t border-gray-200 px-4 py-4">
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
