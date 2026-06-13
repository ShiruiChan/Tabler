import { requireRole } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { AuroraBg } from "@/components/aurora-bg";
import { NavLink } from "@/components/nav-link";
import { TablerGlyph, IconOverview, IconPalette, IconMenu, IconFloor, IconCalendar, IconTicket, IconDelivery, IconLogout, IconExternal } from "@/components/icons";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Обзор", icon: <IconOverview />, exact: true },
  { href: "/dashboard/design", label: "Дизайн сайта", icon: <IconPalette /> },
  { href: "/dashboard/menu", label: "Меню", icon: <IconMenu /> },
  { href: "/dashboard/floor", label: "Схема зала", icon: <IconFloor /> },
  { href: "/dashboard/reservations", label: "Бронирование", icon: <IconCalendar /> },
  { href: "/dashboard/events", label: "События", icon: <IconTicket /> },
  { href: "/dashboard/delivery", label: "Доставка", icon: <IconDelivery /> },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("restaurant_owner", "restaurant_staff");

  // Fetch the tenant name + slug to display in the sidebar.
  let tenantName: string | null = null;
  let tenantSlug: string | null = null;
  if (profile.tenant_id) {
    const supabase = createClient();
    const { data } = await supabase
      .from("tenants")
      .select("name, slug")
      .eq("id", profile.tenant_id)
      .single();
    tenantName = data?.name ?? null;
    tenantSlug = data?.slug ?? null;
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const publicSiteUrl = tenantSlug ? `https://${tenantSlug}.${rootDomain}` : null;

  return (
    <div className="console relative flex min-h-screen">
      <AuroraBg variant="subtle" />

      {/* Sidebar */}
      <aside className="sticky top-0 z-20 flex h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-[#0a0a0b]/80 backdrop-blur-xl">
        <div className="border-b border-white/10 px-5 py-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <TablerGlyph />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-100">
                {tenantName ?? "Дашборд ресторана"}
              </span>
              <span className="block text-[11px] text-slate-500">на Tabler</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} exact={item.exact}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          {publicSiteUrl && (
            <a
              href={publicSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost w-full justify-start"
            >
              <IconExternal className="h-4 w-4" />
              Открыть сайт гостя
            </a>
          )}
          {profile.full_name && (
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-xs font-semibold text-amber-400">
                {profile.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-xs text-slate-400">{profile.full_name}</span>
            </div>
          )}
          <form action={signOut}>
            <button type="submit" className="btn-secondary w-full">
              <IconLogout className="h-4 w-4" />
              Выйти
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative z-10 flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">{children}</div>
      </main>
    </div>
  );
}
