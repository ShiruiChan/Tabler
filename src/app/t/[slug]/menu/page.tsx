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
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Page heading */}
        <header className="animate-fade-up mb-12 text-center">
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
            Меню
          </h1>
        </header>

        {/* Empty state */}
        {categories.length === 0 && (
          <div
            className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: "rgba(0,0,0,0.12)" }}
          >
            <p
              className="text-base"
              style={{ color: "var(--color-primary)", opacity: 0.65 }}
            >
              Меню скоро появится. Загляните позже!
            </p>
          </div>
        )}

        {/* Category sections */}
        {categories.map((category) => (
          <section key={category.id} className="mb-14">
            {/* Category heading */}
            <div
              className="mb-6 flex items-baseline gap-3 border-b pb-3"
              style={{ borderColor: "rgba(0,0,0,0.10)" }}
            >
              <h2
                className="font-heading text-2xl font-semibold tracking-tight"
                style={{ color: "var(--color-primary)" }}
              >
                {category.name}
              </h2>
            </div>
            {category.description && (
              <p
                className="-mt-3 mb-6 text-sm leading-relaxed"
                style={{ color: "var(--color-primary)", opacity: 0.6 }}
              >
                {category.description}
              </p>
            )}

            {/* Dishes */}
            {category.dishes.length === 0 ? (
              <p
                className="text-sm italic"
                style={{ color: "var(--color-primary)", opacity: 0.5 }}
              >
                В этой категории пока нет блюд.
              </p>
            ) : (
              <ul className="space-y-4">
                {category.dishes.map((dish) => (
                  <li
                    key={dish.id}
                    className="flex gap-4 rounded-2xl border bg-white/60 p-4 shadow-sm transition hover:shadow-md sm:p-5"
                    style={{ borderColor: "rgba(0,0,0,0.07)" }}
                  >
                    {/* Photo */}
                    {dish.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={dish.photo_url}
                        alt={dish.name}
                        className="h-24 w-24 flex-shrink-0 rounded-xl object-cover sm:h-28 sm:w-28"
                      />
                    )}

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <span
                          className="font-heading text-base font-semibold sm:text-lg"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {dish.name}
                        </span>
                        <span
                          className="text-sm font-semibold shrink-0 sm:text-base"
                          style={{ color: "var(--color-accent)" }}
                        >
                          {formatPrice(dish.price_cents)}
                        </span>
                      </div>

                      {dish.description && (
                        <p
                          className="text-sm mt-1.5 leading-relaxed"
                          style={{ color: "var(--color-primary)", opacity: 0.65 }}
                        >
                          {dish.description}
                        </p>
                      )}

                      {/* Allergen chips */}
                      {dish.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {dish.allergens.map((allergen) => (
                            <span
                              key={allergen}
                              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                              style={{
                                backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                                color: "var(--color-accent)",
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
