import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { tenantHasModule } from "@/lib/modules";
import { getPublicMenu } from "@/lib/menu-queries";

export const dynamic = "force-dynamic";

interface PublicMenuPageProps {
  params: { slug: string };
}

// ---------------------------------------------------------------------------
// Price helper: cents → "$X.XX"
// ---------------------------------------------------------------------------

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PublicMenuPage({ params }: PublicMenuPageProps) {
  const tenant = await requireTenant(params.slug);

  const menuEnabled = await tenantHasModule(tenant.id, "menu");
  if (!menuEnabled) {
    notFound();
  }

  const categories = await getPublicMenu(tenant.id);

  return (
    <div
      className="font-body min-h-screen"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Page heading */}
        <h1
          className="font-heading text-3xl font-bold mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Our Menu
        </h1>
        <p
          className="text-sm mb-10"
          style={{ color: "var(--color-primary)", opacity: 0.6 }}
        >
          {tenant.name}
        </p>

        {/* Empty state */}
        {categories.length === 0 && (
          <p
            className="text-base"
            style={{ color: "var(--color-primary)", opacity: 0.7 }}
          >
            Our menu is coming soon. Check back later!
          </p>
        )}

        {/* Category sections */}
        {categories.map((category) => (
          <section key={category.id} className="mb-12">
            {/* Category heading */}
            <h2
              className="font-heading text-xl font-semibold mb-1 border-b pb-2"
              style={{
                color: "var(--color-primary)",
                borderColor: "var(--color-primary)",
                opacity: 1,
              }}
            >
              {category.name}
            </h2>
            {category.description && (
              <p
                className="text-sm mb-4 mt-1"
                style={{ color: "var(--color-primary)", opacity: 0.65 }}
              >
                {category.description}
              </p>
            )}

            {/* Dishes */}
            {category.dishes.length === 0 ? (
              <p
                className="text-sm italic mt-3"
                style={{ color: "var(--color-primary)", opacity: 0.5 }}
              >
                No items available in this category yet.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {category.dishes.map((dish) => (
                  <li
                    key={dish.id}
                    className="flex gap-4 rounded-lg p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.04)" }}
                  >
                    {/* Photo */}
                    {dish.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={dish.photo_url}
                        alt={dish.name}
                        className="h-20 w-20 flex-shrink-0 rounded-md object-cover"
                      />
                    )}

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span
                          className="font-heading text-base font-semibold"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {dish.name}
                        </span>
                        <span
                          className="text-sm font-medium shrink-0"
                          style={{ color: "var(--color-accent)" }}
                        >
                          {formatPrice(dish.price_cents)}
                        </span>
                      </div>

                      {dish.description && (
                        <p
                          className="text-sm mt-1 leading-relaxed"
                          style={{ color: "var(--color-primary)", opacity: 0.7 }}
                        >
                          {dish.description}
                        </p>
                      )}

                      {/* Allergen chips */}
                      {dish.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {dish.allergens.map((allergen) => (
                            <span
                              key={allergen}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{
                                backgroundColor: "var(--color-accent)",
                                color: "#fff",
                                opacity: 0.85,
                              }}
                            >
                              {allergen}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
