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
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Page heading */}
        <h1
          className="font-heading text-3xl font-bold mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Our Floor Plan
        </h1>
        <p
          className="text-sm mb-10"
          style={{ color: "var(--color-primary)", opacity: 0.6 }}
        >
          {tenant.name}
        </p>

        {/* Empty state */}
        {plans.length === 0 && (
          <p
            className="text-base"
            style={{ color: "var(--color-primary)", opacity: 0.7 }}
          >
            Floor plan coming soon. Check back later!
          </p>
        )}

        {/* One section per floor plan */}
        {plans.map((plan, index) => (
          <section key={plan.id} className={index > 0 ? "mt-16" : undefined}>
            {/* Show plan name as section heading only when there are multiple plans */}
            {plans.length > 1 && (
              <h2
                className="font-heading text-xl font-semibold mb-6 border-b pb-2"
                style={{
                  color: "var(--color-primary)",
                  borderColor: "var(--color-primary)",
                  opacity: 1,
                }}
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
