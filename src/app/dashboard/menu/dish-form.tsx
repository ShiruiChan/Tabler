"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTransition } from "react";
import { createDish, updateDish, deleteDish } from "@/lib/menu-actions";
import type { MenuActionState } from "@/lib/menu-actions";
import type { Dish, MenuCategory } from "@/lib/types/database";
import { ALLERGENS } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Submit button
// ---------------------------------------------------------------------------

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Сохранение…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Allergen checkboxes (shared)
// ---------------------------------------------------------------------------

function AllergenCheckboxes({ selected }: { selected: string[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-300">
        Аллергены
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ALLERGENS.map((allergen) => (
          <label
            key={allergen}
            className="flex items-center gap-1.5 text-xs text-slate-300"
          >
            <input
              type="checkbox"
              name="allergens"
              value={allergen}
              defaultChecked={selected.includes(allergen)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-amber-500"
            />
            {allergen}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Shared dish fields (used by both create and edit variants)
// ---------------------------------------------------------------------------

function DishFields({
  categories,
  defaultCategoryId,
  defaultValues,
}: {
  categories: MenuCategory[];
  defaultCategoryId?: string;
  defaultValues?: Partial<Dish>;
}) {
  const priceDollars =
    defaultValues?.price_cents != null
      ? (defaultValues.price_cents / 100).toFixed(2)
      : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {/* Name */}
        <div className="flex-1 min-w-[160px]">
          <label className="label-dark">Название блюда</label>
          <input
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={defaultValues?.name ?? ""}
            placeholder="напр. Салат «Цезарь»"
            className="input-dark"
          />
        </div>

        {/* Price */}
        <div className="w-28">
          <label className="label-dark">Цена ($)</label>
          <input
            name="price"
            type="number"
            required
            min={0}
            step={0.01}
            defaultValue={priceDollars}
            placeholder="0.00"
            className="input-dark"
          />
        </div>

        {/* Category */}
        <div className="w-44">
          <label className="label-dark">Категория</label>
          <select
            name="category_id"
            required
            defaultValue={defaultValues?.category_id ?? defaultCategoryId ?? ""}
            className="select-dark"
          >
            <option value="" disabled>
              Выберите…
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Sort order */}
        <div className="w-24">
          <label className="label-dark">Порядок</label>
          <input
            name="sort_order"
            type="number"
            min={0}
            defaultValue={defaultValues?.sort_order ?? 0}
            className="input-dark"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="label-dark">
          Описание <span className="text-slate-500">(необязательно)</span>
        </label>
        <textarea
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={defaultValues?.description ?? ""}
          placeholder="Краткое описание блюда…"
          className="input-dark"
        />
      </div>

      {/* Available checkbox */}
      <div className="flex items-center gap-2">
        <input
          id={`is-available-${defaultValues?.id ?? "new"}`}
          name="is_available"
          type="checkbox"
          value="true"
          defaultChecked={defaultValues?.is_available ?? true}
          onChange={(e) => {
            const hiddenInput =
              e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                'input[type="hidden"][name="is_available"]'
              );
            if (hiddenInput) {
              hiddenInput.disabled = e.currentTarget.checked;
            }
          }}
          className="h-4 w-4 rounded border-white/20 bg-white/5 accent-amber-500"
        />
        {/* Fallback hidden field so unchecked state sends "false" */}
        <input
          type="hidden"
          name="is_available"
          value="false"
          disabled={defaultValues?.is_available ?? true}
        />
        <label
          htmlFor={`is-available-${defaultValues?.id ?? "new"}`}
          className="text-xs font-medium text-slate-300"
        >
          В наличии
        </label>
      </div>

      {/* Allergens */}
      <AllergenCheckboxes selected={defaultValues?.allergens ?? []} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateDishForm
// ---------------------------------------------------------------------------

interface CreateDishFormProps {
  categories: MenuCategory[];
  defaultCategoryId: string;
}

const createInitialState: MenuActionState = null;

export function CreateDishForm({
  categories,
  defaultCategoryId,
}: CreateDishFormProps) {
  const [state, formAction] = useFormState(createDish, createInitialState);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4"
    >
      <p className="eyebrow">Добавить блюдо</p>

      {state?.error && (
        <p role="alert" className="text-xs text-rose-300">
          {state.error}
        </p>
      )}

      <DishFields
        categories={categories}
        defaultCategoryId={defaultCategoryId}
      />

      <div>
        <SubmitButton label="Добавить блюдо" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// EditDishForm
// ---------------------------------------------------------------------------

interface EditDishFormProps {
  dish: Dish;
  categories: MenuCategory[];
}

const editInitialState: MenuActionState = null;

export function EditDishForm({ dish, categories }: EditDishFormProps) {
  const [state, formAction] = useFormState(updateDish, editInitialState);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Удалить блюдо «${dish.name}»?`)) return;
    startTransition(async () => {
      await deleteDish(dish.id);
    });
  }

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-rose-300">
          {state.error}
        </p>
      )}

      {/* Hidden id */}
      <input type="hidden" name="id" value={dish.id} />

      <DishFields categories={categories} defaultValues={dish} />

      <div className="flex items-center gap-2">
        <SubmitButton label="Сохранить блюдо" />
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="btn-danger"
        >
          {isPending ? "Удаление…" : "Удалить"}
        </button>
      </div>
    </form>
  );
}
