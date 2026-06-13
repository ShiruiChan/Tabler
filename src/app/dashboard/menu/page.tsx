import { getProfile } from "@/lib/auth";
import { getFullMenu } from "@/lib/menu-queries";
import { redirect } from "next/navigation";
import { CreateCategoryForm, EditCategoryForm } from "./category-form";
import { CreateDishForm, EditDishForm } from "./dish-form";
import DishPhotoUploader from "./dish-photo-uploader";
import { PageHeader, PanelCard, EmptyState, Badge } from "@/components/ui";
import { IconMenu } from "@/components/icons";

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
      <div className="alert-error">
        Ваш аккаунт не привязан к ресторану. Обратитесь в поддержку.
      </div>
    );
  }

  const tenantId = profile.tenant_id;
  const categories = await getFullMenu(tenantId);

  // Flat list of all categories - used for the "category" select in dish forms.
  const allCategories = categories;

  return (
    <div>
      <PageHeader
        eyebrow="Меню"
        title="Управление меню"
        description="Создавайте категории и блюда, добавляйте фото, цены и аллергены."
      />

      <div className="space-y-8">
        {/* Add category form */}
        <PanelCard title="Добавить категорию">
          <CreateCategoryForm />
        </PanelCard>

        {/* Category list */}
        {categories.length === 0 ? (
          <EmptyState
            icon={<IconMenu className="h-6 w-6" />}
            title="Пока нет категорий"
            description="Добавьте первую категорию выше, чтобы начать наполнять меню."
          />
        ) : (
          <div className="space-y-6">
            {categories.map((category) => (
              <section key={category.id} className="glass overflow-hidden">
                {/* Category header */}
                <div className="border-b border-white/10 px-6 py-4">
                  <div className="mb-1 flex items-center gap-3">
                    <h2 className="text-base font-semibold text-slate-100">
                      {category.name}
                    </h2>
                    {!category.is_active && (
                      <Badge tone="slate">Неактивна</Badge>
                    )}
                  </div>
                  {category.description && (
                    <p className="text-xs text-slate-400">
                      {category.description}
                    </p>
                  )}
                </div>

                {/* Edit category controls */}
                <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
                  <p className="eyebrow mb-3">Редактировать категорию</p>
                  <EditCategoryForm category={category} />
                </div>

                {/* Dish list */}
                {category.dishes.length > 0 && (
                  <div className="divide-y divide-white/10">
                    {category.dishes.map((dish) => (
                      <div key={dish.id} className="space-y-4 px-6 py-4">
                        {/* Dish summary row */}
                        <div className="flex items-start gap-4">
                          {/* Photo thumbnail + uploader */}
                          <DishPhotoUploader
                            tenantId={tenantId}
                            dishId={dish.id}
                            currentPhotoUrl={dish.photo_url}
                          />

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">
                                {dish.name}
                              </span>
                              <span className="text-sm text-amber-400">
                                {formatPrice(dish.price_cents)}
                              </span>
                              {dish.is_available ? (
                                <Badge tone="emerald">В наличии</Badge>
                              ) : (
                                <Badge tone="rose">Нет в наличии</Badge>
                              )}
                            </div>
                            {dish.description && (
                              <p className="line-clamp-2 text-xs text-slate-400">
                                {dish.description}
                              </p>
                            )}
                            {dish.allergens.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {dish.allergens.map((allergen) => (
                                  <Badge key={allergen} tone="amber">
                                    {allergen}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Edit dish form */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                          <p className="eyebrow mb-3">Редактировать блюдо</p>
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
    </div>
  );
}
