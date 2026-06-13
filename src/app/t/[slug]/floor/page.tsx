import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { tenantHasModule } from "@/lib/modules";
import { getPublicFloorPlans } from "@/lib/floor-queries";
import { FloorPlanPicker } from "./table-picker";

export const dynamic = "force-dynamic";

interface PublicFloorPageProps {
  params: { slug: string };
}

export default async function PublicFloorPage({ params }: PublicFloorPageProps) {
  const tenant = await requireTenant(params.slug);

  const [floorEnabled, reservationsEnabled] = await Promise.all([
    tenantHasModule(tenant.id, "floor_plan"),
    tenantHasModule(tenant.id, "reservations"),
  ]);

  if (!floorEnabled) {
    notFound();
  }

  const plans = await getPublicFloorPlans(tenant.id);
  // When reservations module is active, the picker's "Book this table" CTA
  // links to the reserve page with the selected table pre-populated.
  const reserveHref = reservationsEnabled ? "./reserve" : undefined;

  return (
    <div
      className="font-body min-h-screen"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* Page heading */}
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
            План зала
          </h1>
        </header>

        {/* Empty state */}
        {plans.length === 0 && (
          <div
            className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: "rgba(0,0,0,0.12)" }}
          >
            <p
              className="text-base"
              style={{ color: "var(--color-primary)", opacity: 0.65 }}
            >
              План зала скоро появится. Загляните позже!
            </p>
          </div>
        )}

        {/* One section per floor plan */}
        {plans.map((plan, index) => (
          <section
            key={plan.id}
            className={
              index > 0
                ? "mt-10 rounded-2xl border bg-white/60 p-5 shadow-sm sm:p-6"
                : "rounded-2xl border bg-white/60 p-5 shadow-sm sm:p-6"
            }
            style={{ borderColor: "rgba(0,0,0,0.07)" }}
          >
            {/* Show plan name as section heading only when there are multiple plans */}
            {plans.length > 1 && (
              <h2
                className="font-heading text-xl font-semibold mb-5"
                style={{ color: "var(--color-primary)" }}
              >
                {plan.name}
              </h2>
            )}

            <FloorPlanPicker plan={plan} reserveHref={reserveHref} />
          </section>
        ))}
      </div>
    </div>
  );
}
