import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { tenantHasModule, MODULES } from "@/lib/modules";
import { getPublicMenu } from "@/lib/menu-queries";
import { getOrderingContext, getMyOrders } from "@/lib/order-queries";
import { getPublicFloorPlans } from "@/lib/floor-queries";
import { createClient } from "@/lib/supabase/server";
import { OrderShell } from "./order-shell";
import { MyOrders } from "./my-orders";

export const dynamic = "force-dynamic";

interface OrderPageProps {
  params: { slug: string };
}

export default async function OrderPage({ params }: OrderPageProps) {
  const tenant = await requireTenant(params.slug);

  // Module gating: MODULES.ordering gates the entire page.
  // MODULES.delivery additionally gates the delivery order_type (checked
  // inside placeOrder and the UI shell via deliveryEnabled flag).
  const [orderingEnabled, deliveryEnabled] = await Promise.all([
    tenantHasModule(tenant.id, MODULES.ordering),
    tenantHasModule(tenant.id, MODULES.delivery),
  ]);

  if (!orderingEnabled) {
    notFound();
  }

  // Load all data in parallel.
  const supabase = createClient();
  const [
    menu,
    orderingContext,
    floorPlans,
    { data: userData },
  ] = await Promise.all([
    getPublicMenu(tenant.id),
    getOrderingContext(tenant.id),
    getPublicFloorPlans(tenant.id),
    supabase.auth.getUser(),
  ]);

  const isAuthenticated = !!userData?.user;
  // getMyOrders already filters by tenantId (cross-tenant bleed fix - see
  // order-queries.ts design note).
  const myOrders = isAuthenticated ? await getMyOrders(tenant.id) : [];

  return (
    <div
      className="font-body min-h-screen"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* ── Page heading ──────────────────────────────────────────────── */}
        <header className="animate-fade-up mb-10">
          <span
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-accent)" }}
          >
            {tenant.name}
          </span>
          <h1
            className="font-heading mt-2 text-4xl font-bold tracking-tight md:text-5xl"
            style={{ color: "var(--color-primary)" }}
          >
            Заказ
          </h1>
        </header>

        {/* ── Order shell (cart + checkout) ─────────────────────────────── */}
        <OrderShell
          tenantId={tenant.id}
          menu={menu}
          floorPlans={floorPlans}
          orderingContext={orderingContext}
          deliveryEnabled={deliveryEnabled}
        />

        {/* ── My orders (authenticated visitors only) ───────────────────── */}
        {isAuthenticated && (
          <section aria-label="Мои заказы" className="mt-16">
            <h2
              className="font-heading text-2xl font-bold mb-2"
              style={{ color: "var(--color-primary)" }}
            >
              Мои заказы
            </h2>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--color-primary)", opacity: 0.6 }}
            >
              История заказов в {tenant.name}
            </p>
            <MyOrders orders={myOrders} />
          </section>
        )}
      </div>
    </div>
  );
}
