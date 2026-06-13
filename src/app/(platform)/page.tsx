import Link from "next/link";
import { getSession, getProfile } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";
import type { UserRole, Profile } from "@/lib/types/database";
import type { User } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ─── Role helpers ─────────────────────────────────────────────────────────────

interface WorkspaceInfo {
  path: string;
  label: string;
  badge: string;
}

function getWorkspace(role: UserRole): WorkspaceInfo {
  switch (role) {
    case "super_admin":
      return { path: "/admin", label: "Админ-консоль", badge: "Админ" };
    case "restaurant_owner":
      return { path: "/dashboard", label: "Открыть дашборд", badge: "Владелец" };
    case "restaurant_staff":
      return { path: "/dashboard", label: "Открыть дашборд", badge: "Сотрудник" };
    default:
      return { path: "/t/demo-bistro", label: "Открыть демо", badge: "Гость" };
  }
}

function getDisplayName(user: User, profile: Profile | null): string {
  return profile?.full_name ?? user.email ?? "Аккаунт";
}

// ─── Inline SVG icons (aria-hidden decorative) ────────────────────────────────

function IconMenu() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

function IconFloor() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconTicket() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
    </svg>
  );
}

function IconDelivery() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" />
      <rect x="9" y="11" width="14" height="10" rx="2" />
      <circle cx="12" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
    </svg>
  );
}

function IconPalette() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

// ─── Product mock card ────────────────────────────────────────────────────────

function ProductMock() {
  return (
    <div
      aria-hidden="true"
      className="animate-float relative w-full max-w-sm mx-auto lg:mx-0"
    >
      {/* outer glow */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-400/20 to-orange-500/10 blur-2xl" />
      {/* glass card */}
      <div className="relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-5 shadow-2xl">
        {/* header bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-xs font-semibold text-amber-400 tracking-wide">Демо-бистро</span>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">Открыто</span>
        </div>

        {/* menu items */}
        <div className="space-y-2.5">
          {[
            { name: "Ризотто с трюфелем", desc: "Лесные грибы, пармезан, масло шнитт-лука", price: "890 ₽" },
            { name: "Сибас в папильоте", desc: "Фенхель, каперсы, лимонный бёр-блан", price: "1 290 ₽" },
            { name: "Говяжья вырезка", desc: "Соус на красном вине, пюре, трюфель", price: "1 850 ₽" },
          ].map((dish) => (
            <div key={dish.name} className="flex items-start justify-between rounded-xl bg-white/5 border border-white/8 px-3.5 py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">{dish.name}</p>
                <p className="text-xs text-slate-400 truncate mt-0.5">{dish.desc}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-amber-400">{dish.price}</span>
            </div>
          ))}
        </div>

        {/* divider */}
        <div className="my-3 h-px bg-white/8" />

        {/* reservation chip */}
        <div className="flex items-center gap-3 rounded-xl bg-amber-400/10 border border-amber-400/20 px-3.5 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20">
            <svg aria-hidden="true" className="h-3.5 w-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-300">Стол 4 · Сегодня 19:30</p>
            <p className="text-[11px] text-slate-400">На 2 гостей · Подтверждено</p>
          </div>
          <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">✓</span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LandingPage() {
  const user = await getSession();
  const profile = user ? await getProfile() : null;

  const isLoggedIn = !!user;
  const role: UserRole = profile?.role ?? "visitor";
  const workspace = getWorkspace(role);
  const displayName = user ? getDisplayName(user, profile) : null;
  const isB2BRole = role === "restaurant_owner" || role === "restaurant_staff" || role === "super_admin";

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-slate-100 overflow-x-hidden">

      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0b]/80 backdrop-blur-xl">
        <nav
          aria-label="Основная навигация"
          className="mx-auto flex max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8 h-16"
        >
          {/* Wordmark */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-md" aria-label="Tabler — на главную">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
                <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.7" />
                <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.7" />
                <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.4" />
              </svg>
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-100">Tabler</span>
          </Link>

          {/* Centre anchor links — hidden on small screens */}
          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {[
              { href: "#for-restaurants", label: "Для ресторанов" },
              { href: "#for-guests", label: "Для гостей" },
              { href: "#features", label: "Возможности" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Auth cluster */}
          <div className="ml-auto flex shrink-0 items-center gap-2 flex-wrap justify-end">
            {isLoggedIn && user ? (
              <>
                {/* Account chip */}
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  <span className="text-xs font-medium text-slate-200 max-w-[120px] truncate">
                    {displayName}
                  </span>
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
                    {workspace.badge}
                  </span>
                </div>

                {/* Workspace CTA */}
                <Link
                  href={workspace.path}
                  className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-3.5 py-1.5 text-sm font-semibold text-[#0a0a0b] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  {workspace.label}
                </Link>

                {/* Sign out */}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/10 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    Выйти
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3.5 py-1.5 text-sm text-slate-300 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  Войти
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-3.5 py-1.5 text-sm font-semibold text-[#0a0a0b] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  Начать
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="relative isolate overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32">
          {/* Aurora background */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            {/* dot grid overlay */}
            <div
              className="absolute inset-0 opacity-[0.15]"
              style={{
                backgroundImage: "radial-gradient(circle, #94a3b8 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
            {/* top vignette */}
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0a0a0b] to-transparent" />
            {/* bottom vignette */}
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0b] to-transparent" />

            {/* blob 1 — amber */}
            <div className="animate-aurora-1 absolute -top-40 left-1/4 h-[600px] w-[600px] rounded-full bg-amber-500/20 blur-[120px]" />
            {/* blob 2 — rose */}
            <div className="animate-aurora-2 absolute top-20 -right-20 h-[500px] w-[500px] rounded-full bg-rose-500/15 blur-[100px]" />
            {/* blob 3 — violet */}
            <div className="animate-aurora-3 absolute bottom-0 left-10 h-[400px] w-[400px] rounded-full bg-violet-600/15 blur-[100px]" />
          </div>

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

            {/* Logged-in greeting strip */}
            {isLoggedIn && user && (
              <div className="animate-fade-up mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/15">
                    <svg aria-hidden="true" className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      Вы вошли как <span className="text-amber-400">{displayName}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      Роль:{" "}
                      <span className="font-semibold text-slate-300">{workspace.badge}</span>
                    </p>
                  </div>
                </div>
                <Link
                  href={workspace.path}
                  className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-sm font-semibold text-[#0a0a0b] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  {workspace.label} →
                </Link>
              </div>
            )}

            <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
              {/* Text side */}
              <div className="flex-1 text-center lg:text-left">
                {/* eyebrow */}
                <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-400 mb-6">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  White-label платформа для ресторанов
                </div>

                <h1 className="animate-fade-up-delay-1 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-balance text-slate-50 leading-[1.05] mb-6">
                  Полноценная платформа{" "}
                  <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                    для вашего ресторана.
                  </span>
                </h1>

                <p className="animate-fade-up-delay-2 max-w-xl mx-auto lg:mx-0 text-lg text-slate-300 leading-relaxed mb-8">
                  Один дашборд управляет всей цифровой работой ресторана — меню, схемой зала, бронированием, событиями и доставкой — и всё это под{" "}
                  <span className="text-slate-100 font-medium">вашим брендом и вашим доменом</span>.
                  Гости никогда не видят Tabler.
                </p>

                {/* CTA cluster */}
                <div className="animate-fade-up-delay-2 flex flex-wrap items-center gap-3 justify-center lg:justify-start">
                  {isLoggedIn ? (
                    <>
                      <Link
                        href={workspace.path}
                        className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-base font-semibold text-[#0a0a0b] shadow-lg shadow-amber-500/25 hover:opacity-90 transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        {workspace.label}
                      </Link>
                      {!isB2BRole && (
                        <Link
                          href="/t/demo-bistro"
                          className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-base text-slate-300 hover:bg-white/10 hover:text-slate-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                          Открыть демо
                        </Link>
                      )}
                      {!isB2BRole && (
                        <p className="w-full text-xs text-slate-500 lg:text-left text-center">
                          У аккаунтов ресторанов есть полный дашборд →{" "}
                          <Link href="/signup" className="text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 rounded">
                            Создать ресторан
                          </Link>
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <Link
                        href="/signup"
                        className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-base font-semibold text-[#0a0a0b] shadow-lg shadow-amber-500/25 hover:opacity-90 transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        Начать бесплатно
                      </Link>
                      <Link
                        href="/t/demo-bistro"
                        className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-base text-slate-300 hover:bg-white/10 hover:text-slate-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        Открыть демо
                      </Link>
                    </>
                  )}
                </div>

                {/* trust line */}
                <p className="animate-fade-up-delay-2 mt-8 text-xs text-slate-500 tracking-wide">
                  Меню · Бронирование · Схема зала · События · Доставка — одна платформа
                </p>
              </div>

              {/* Product mock */}
              <div className="flex-1 w-full max-w-sm lg:max-w-none">
                <ProductMock />
              </div>
            </div>
          </div>
        </section>

        {/* ── Dual-audience split ── */}
        <section id="for-restaurants" className="py-20 sm:py-28 scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="sr-only">Для кого создан Tabler</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* B2B card */}
              <div className="group relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 hover:bg-white/8 hover:border-amber-400/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-amber-500/10">
                {/* gradient accent */}
                <div aria-hidden="true" className="absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />

                <div className="relative">
                  <div className="flex items-center gap-3 mb-6">
                    <span className="rounded-full bg-amber-400/15 border border-amber-400/25 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-400">
                      B2B
                    </span>
                    <span className="text-xs text-slate-500">Для ресторанов</span>
                  </div>

                  <h3 className="text-2xl font-bold text-slate-50 mb-3" id="for-restaurants-heading">
                    Управляйте всем из одного дашборда
                  </h3>
                  <p className="text-slate-400 mb-6 leading-relaxed">
                    Ваш бренд, ваш домен — и невидимый движок Tabler внутри. Всё, что нужно команде, в едином и понятном рабочем пространстве.
                  </p>

                  <ul className="space-y-2.5 mb-8">
                    {[
                      "Полный white-label брендинг — ваш логотип, палитра, шрифты, свой домен",
                      "Управление меню в реальном времени: категории, блюда, аллергены",
                      "Интерактивный редактор схемы зала и управление столами",
                      "Бронирование с доступностью в реальном времени и историей гостей",
                      "События и продажа билетов — от камерных ужинов до полного выкупа зала",
                      "Настройка зон доставки, расписания и отслеживание заказов",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-slate-300">
                        <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>

                  {isLoggedIn && isB2BRole ? (
                    <Link
                      href={workspace.path}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      {workspace.label}
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </Link>
                  ) : (
                    <Link
                      href="/signup"
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Начать бесплатно
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </Link>
                  )}
                </div>
              </div>

              {/* B2C card */}
              <div id="for-guests" className="group relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 hover:bg-white/8 hover:border-violet-400/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-violet-500/10 scroll-mt-20">
                <div aria-hidden="true" className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />

                <div className="relative">
                  <div className="flex items-center gap-3 mb-6">
                    <span className="rounded-full bg-violet-400/15 border border-violet-400/25 px-3 py-1 text-xs font-bold uppercase tracking-widest text-violet-400">
                      B2C
                    </span>
                    <span className="text-xs text-slate-500">Для ваших гостей</span>
                  </div>

                  <h3 className="text-2xl font-bold text-slate-50 mb-3">
                    Красивый брендированный сайт для каждого гостя
                  </h3>
                  <p className="text-slate-400 mb-6 leading-relaxed">
                    Гости получают отточенный, mobile-first опыт на вашем собственном адресе — смотрят меню, бронируют стол, заказывают еду или покупают билеты на события.
                  </p>

                  <ul className="space-y-2.5 mb-8">
                    {[
                      "Эффектное меню с фото, фильтрами по аллергенам и наличием в реальном времени",
                      "Удобное бронирование — выбор стола прямо на схеме зала",
                      "Заказ за столом и оформление доставки",
                      "Подбор событий и покупка билетов в одном сценарии",
                      "Полностью брендировано — ваши цвета, логотип, ваш домен",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-slate-300">
                        <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/t/demo-bistro"
                    className="inline-flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-400/10 px-5 py-2.5 text-sm font-semibold text-violet-300 hover:bg-violet-400/15 hover:text-violet-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    Посмотреть опыт гостя
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </Link>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── Feature grid ── */}
        <section id="features" className="py-20 sm:py-28 scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-3">Модули платформы</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-50 tracking-tight text-balance">
                Шесть модулей. Один дашборд.
              </h2>
              <p className="mt-4 text-slate-400 max-w-2xl mx-auto">
                Всё необходимое для работы современного ресторана — встроено, а не прикручено сбоку.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                {
                  icon: <IconMenu />,
                  title: "Управление меню",
                  desc: "Группируйте блюда по категориям, добавляйте фото, указывайте аллергены и управляйте наличием в реальном времени.",
                  accent: "text-amber-400",
                  glow: "from-amber-500/8",
                },
                {
                  icon: <IconFloor />,
                  title: "Редактор схемы зала",
                  desc: "Нарисуйте обеденный зал, расставьте столы и покажите гостям, где именно они будут сидеть.",
                  accent: "text-orange-400",
                  glow: "from-orange-500/8",
                },
                {
                  icon: <IconCalendar />,
                  title: "Бронирование",
                  desc: "Онлайн-бронь с правилами доступности, лимитами по числу гостей и управлением загрузкой в реальном времени.",
                  accent: "text-rose-400",
                  glow: "from-rose-500/8",
                },
                {
                  icon: <IconTicket />,
                  title: "События и билеты",
                  desc: "Публикуйте события с билетами — от винных дегустаций до закрытых ужинов у шефа — и продавайте места онлайн.",
                  accent: "text-violet-400",
                  glow: "from-violet-500/8",
                },
                {
                  icon: <IconDelivery />,
                  title: "Доставка и заказы",
                  desc: "Настройте зоны доставки, расписание, минимальный заказ и комиссии. Принимайте заказы в зале и на доставку в одной очереди.",
                  accent: "text-sky-400",
                  glow: "from-sky-500/8",
                },
                {
                  icon: <IconPalette />,
                  title: "White-label дизайн",
                  desc: "Загрузите логотип, задайте палитру и шрифты, подключите свой домен. Гости никогда не видят Tabler.",
                  accent: "text-emerald-400",
                  glow: "from-emerald-500/8",
                },
              ].map(({ icon, title, desc, accent, glow }) => (
                <div
                  key={title}
                  className="group relative rounded-2xl border border-white/8 bg-white/4 backdrop-blur-md p-6 hover:bg-white/7 hover:border-white/15 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
                >
                  <div aria-hidden="true" className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${glow} to-transparent pointer-events-none`} />
                  <div className="relative">
                    <div className={`mb-4 ${accent}`}>{icon}</div>
                    <h3 className="text-base font-semibold text-slate-100 mb-1.5">{title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── White-label highlight band ── */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/4 backdrop-blur-md px-8 sm:px-16 py-14 text-center">
              {/* decorative glow */}
              <div aria-hidden="true" className="absolute -top-32 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-amber-500/15 blur-[80px]" />
              <div className="relative">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-4">White-label прежде всего</p>
                <h2 className="text-3xl sm:text-4xl font-bold text-slate-50 tracking-tight text-balance mb-5">
                  Ваш бренд, а не наш.
                </h2>
                <p className="mx-auto max-w-2xl text-slate-300 text-lg leading-relaxed">
                  Каждый пиксель, который видит гость, несёт ваш логотип, ваши цвета, вашу типографику — и отдаётся с вашего домена.
                  Tabler работает невидимо в фоне, поэтому ваш ресторан выглядит как продукт на заказ, а не как типовой SaaS-шаблон.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-slate-400">
                  {["Ваш логотип", "Ваша палитра", "Ваши шрифты", "Ваш домен", "Ваш тон бренда"].map((item) => (
                    <span key={item} className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/5 px-3.5 py-1.5">
                      <svg aria-hidden="true" className="h-3.5 w-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stats band ── */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { stat: "6", label: "Модулей платформы", sub: "По одному на каждую функцию" },
                { stat: "1", label: "Дашборд", sub: "Всё в одном месте" },
                { stat: "0", label: "Строк кода", sub: "Без технической настройки" },
                { stat: "∞", label: "Столов", sub: "Масштаб по мере роста" },
              ].map(({ stat, label, sub }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/8 bg-white/4 px-6 py-7 text-center hover:border-amber-400/20 hover:bg-white/6 transition-colors"
                >
                  <p className="text-4xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">{stat}</p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-200">{label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA band ── */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-rose-500/10 border border-white/10 px-8 sm:px-16 py-20 text-center">
              {/* aurora blobs inside CTA */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
                <div className="animate-aurora-1 absolute -top-20 left-1/4 h-72 w-72 rounded-full bg-amber-500/25 blur-[80px]" />
                <div className="animate-aurora-2 absolute -bottom-20 right-1/4 h-72 w-72 rounded-full bg-orange-500/20 blur-[80px]" />
              </div>

              <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-4">Начните сегодня</p>
              <h2 className="text-3xl sm:text-5xl font-bold text-slate-50 tracking-tight text-balance mb-5">
                Ваш ресторан заслуживает платформу под стать его амбициям.
              </h2>
              <p className="mx-auto max-w-xl text-lg text-slate-300 mb-10">
                Настройте всю цифровую работу за считаные минуты — без инженеров, без контрактов, без привязки к поставщику.
              </p>

              <div className="flex flex-wrap justify-center gap-4">
                {isLoggedIn ? (
                  <>
                    <Link
                      href={workspace.path}
                      className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-8 py-3.5 text-base font-semibold text-[#0a0a0b] shadow-lg shadow-amber-500/30 hover:opacity-90 transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      {workspace.label}
                    </Link>
                    <Link
                      href="/t/demo-bistro"
                      className="rounded-xl border border-white/20 bg-white/8 px-8 py-3.5 text-base text-slate-200 hover:bg-white/12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Открыть демо
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-8 py-3.5 text-base font-semibold text-[#0a0a0b] shadow-lg shadow-amber-500/30 hover:opacity-90 transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Начать бесплатно
                    </Link>
                    <Link
                      href="/t/demo-bistro"
                      className="rounded-xl border border-white/20 bg-white/8 px-8 py-3.5 text-base text-slate-200 hover:bg-white/12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      Открыть демо
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/8 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-6 mb-12">
            {/* Brand */}
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-md" aria-label="Tabler — на главную">
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
                    <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.7" />
                    <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.7" />
                    <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.4" />
                  </svg>
                </span>
                <span className="text-base font-semibold text-slate-100">Tabler</span>
              </Link>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                White-label SaaS-платформа, которая невидимо обеспечивает работу современных ресторанов.
              </p>
            </div>

            {/* Product */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Продукт</p>
              <ul className="space-y-2.5">
                {[
                  { href: "#features", label: "Возможности" },
                  { href: "#for-restaurants", label: "Для ресторанов" },
                  { href: "/signup", label: "Создать ресторан" },
                  { href: "/t/demo-bistro", label: "Демо для гостей" },
                ].map(({ href, label }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-sm text-slate-400 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 rounded"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Account */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Аккаунт</p>
              <ul className="space-y-2.5">
                {[
                  { href: "/login", label: "Войти" },
                  { href: "/signup", label: "Начать" },
                  { href: "/t/demo-bistro", label: "Для гостей →" },
                ].map(({ href, label }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-sm text-slate-400 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 rounded"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-white/8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-600">© 2026 Tabler. Все права защищены.</p>
            <p className="text-xs text-slate-600">White-label платформа для ресторанов</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
