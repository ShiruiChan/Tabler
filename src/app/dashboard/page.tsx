import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { PageHeader, PanelCard, Badge } from "@/components/ui";
import {
  IconPalette,
  IconMenu,
  IconFloor,
  IconCalendar,
  IconTicket,
  IconDelivery,
  IconArrowRight,
  IconExternal,
} from "@/components/icons";

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

  const modules = [
    {
      href: "/dashboard/design",
      label: "Дизайн сайта",
      desc: "Логотип, палитра, шрифты и описание ресторана.",
      icon: <IconPalette className="h-5 w-5" />,
    },
    {
      href: "/dashboard/menu",
      label: "Меню",
      desc: "Категории, блюда, фото и аллергены.",
      icon: <IconMenu className="h-5 w-5" />,
    },
    {
      href: "/dashboard/floor",
      label: "Схема зала",
      desc: "Расстановка столов и зон обслуживания.",
      icon: <IconFloor className="h-5 w-5" />,
    },
    {
      href: "/dashboard/reservations",
      label: "Бронирование",
      desc: "Онлайн-брони и управление загрузкой.",
      icon: <IconCalendar className="h-5 w-5" />,
    },
    {
      href: "/dashboard/events",
      label: "События",
      desc: "Афиша событий и продажа билетов.",
      icon: <IconTicket className="h-5 w-5" />,
    },
    {
      href: "/dashboard/delivery",
      label: "Доставка",
      desc: "Зоны, расписание и заказы на доставку.",
      icon: <IconDelivery className="h-5 w-5" />,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Обзор"
        title={tenantName ?? "Дашборд ресторана"}
        description={`Добро пожаловать${
          profile?.full_name ? `, ${profile.full_name}` : ""
        }. Управляйте цифровым присутствием вашего ресторана из одного места.`}
        actions={
          publicSiteUrl && (
            <a
              href={publicSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <IconExternal className="h-4 w-4" />
              Открыть сайт гостя
            </a>
          )
        }
      />

      <div className="space-y-8">
        {/* Restaurant info */}
        <PanelCard title="О ресторане">
          <dl className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
              <dt className="w-32 shrink-0 text-sm font-medium text-slate-500">
                Название
              </dt>
              <dd className="text-sm text-slate-100">{tenantName ?? "-"}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
              <dt className="w-32 shrink-0 text-sm font-medium text-slate-500">
                Статус
              </dt>
              <dd className="text-sm text-slate-100">
                {tenantStatus ? (
                  <Badge tone={tenantStatus === "active" ? "emerald" : "amber"}>
                    {tenantStatus === "active" ? "Активен" : tenantStatus}
                  </Badge>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
              <dt className="w-32 shrink-0 text-sm font-medium text-slate-500">
                Адрес сайта
              </dt>
              <dd className="min-w-0 text-sm text-slate-100">
                {publicSiteUrl ? (
                  <a
                    href={publicSiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-amber-400 transition-colors hover:text-amber-300"
                  >
                    <span className="truncate">{publicSiteUrl}</span>
                    <IconExternal className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  "-"
                )}
              </dd>
            </div>
          </dl>
        </PanelCard>

        {/* Quick links to modules */}
        <div>
          <p className="eyebrow mb-4">Модули</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="glass glass-hover group flex flex-col gap-2 p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400">
                    {m.icon}
                  </span>
                  <IconArrowRight className="h-4 w-4 text-slate-600 transition-colors group-hover:text-amber-400" />
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  {m.label}
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                  {m.desc}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
