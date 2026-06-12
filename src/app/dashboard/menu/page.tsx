import { getProfile } from "@/lib/auth";
import { getFullMenu } from "@/lib/menu-queries";
import { redirect } from "next/navigation";
import { CreateCategoryForm, EditCategoryForm } from "./category-form";
import { CreateDishForm, EditDishForm } from "./dish-form";
import DishPhotoUploader from "./dish-photo-uploader";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Price helper: cents → "$X.XX"
// ---------------------------------------------------------------------------

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MenuPage() {
  const profile = await getProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.tenant_id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5">
        <p className="text-sm text-red-700">
          Your account is not associated with a restaurant. Contact support.
        </p>
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const categories = await getFullMenu(tenantId);

  // Flat list of all categories — used for the "category" select in dish forms.
  const allCategories = categories;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your menu categories and dishes.
        </p>
      </div>

      {/* Add category form */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Add category
        </h2>
        <CreateCategoryForm />
      </section>

      {/* Category list */}
      {categories.length === 0 ? (
        <p className="text-sm text-gray-500">
          No categories yet. Add one above to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {categories.map((category) => (
            <section
              key={category.id}
              className="rounded-lg border border-gray-200 bg-white"
            >
              {/* Category header */}
              <div className="border-b border-gray-100 px-6 py-4">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-base font-semibold text-gray-900">
                    {category.name}
                  </h2>
                  {!category.is_active && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Inactive
                    </span>
                  )}
                </div>
                {category.description && (
                  <p className="text-xs text-gray-500">{category.description}</p>
                )}
              </div>

              {/* Edit category controls */}
              <div className="border-b border-gray-100 px-6 py-4 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Edit category
                </p>
                <EditCategoryForm category={category} />
              </div>

              {/* Dish list */}
              {category.dishes.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {category.dishes.map((dish) => (
                    <div
                      key={dish.id}
                      className="px-6 py-4 space-y-4"
                    >
                      {/* Dish summary row */}
                      <div className="flex items-start gap-4">
                        {/* Photo thumbnail + uploader */}
                        <DishPhotoUploader
                          tenantId={tenantId}
                          dishId={dish.id}
                          currentPhotoUrl={dish.photo_url}
                        />

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">
                              {dish.name}
                            </span>
                            <span className="text-sm text-gray-500">
                              {formatPrice(dish.price_cents)}
                            </span>
                            {dish.is_available ? (
                              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                Available
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                                Unavailable
                              </span>
                            )}
                          </div>
                          {dish.description && (
                            <p className="text-xs text-gray-500 line-clamp-2">
                              {dish.description}
                            </p>
                          )}
                          {dish.allergens.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {dish.allergens.map((allergen) => (
                                <span
                                  key={allergen}
                                  className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                                >
                                  {allergen}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Edit dish form */}
                      <div className="bg-gray-50 rounded-md p-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                          Edit dish
                        </p>
                        <EditDishForm
                          dish={dish}
                          categories={allCategories}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add dish form */}
              <div className="px-6 py-4">
                <CreateDishForm
                  categories={allCategories}
                  defaultCategoryId={category.id}
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
