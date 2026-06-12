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
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Allergen checkboxes (shared)
// ---------------------------------------------------------------------------

function AllergenCheckboxes({ selected }: { selected: string[] }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-gray-600 mb-1">
        Allergens
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {ALLERGENS.map((allergen) => (
          <label key={allergen} className="flex items-center gap-1 text-xs text-gray-700">
            <input
              type="checkbox"
              name="allergens"
              value={allergen}
              defaultChecked={selected.includes(allergen)}
              className="h-3.5 w-3.5 rounded border-gray-300"
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
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Dish name
          </label>
          <input
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={defaultValues?.name ?? ""}
            placeholder="e.g. Caesar Salad"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Price */}
        <div className="w-28">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Price ($)
          </label>
          <input
            name="price"
            type="number"
            required
            min={0}
            step={0.01}
            defaultValue={priceDollars}
            placeholder="0.00"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Category */}
        <div className="w-44">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Category
          </label>
          <select
            name="category_id"
            required
            defaultValue={defaultValues?.category_id ?? defaultCategoryId ?? ""}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          >
            <option value="" disabled>
              Select…
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
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Order
          </label>
          <input
            name="sort_order"
            type="number"
            min={0}
            defaultValue={defaultValues?.sort_order ?? 0}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Description <span className="text-gray-400">(optional)</span>
        </label>
        <textarea
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={defaultValues?.description ?? ""}
          placeholder="Short description of the dish…"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
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
          className="h-4 w-4 rounded border-gray-300"
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
          className="text-xs font-medium text-gray-600"
        >
          Available
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
    <form action={formAction} className="space-y-3 rounded-md border border-dashed border-gray-300 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Add dish
      </p>

      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      <DishFields
        categories={categories}
        defaultCategoryId={defaultCategoryId}
      />

      <div>
        <SubmitButton label="Add dish" />
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
    if (!confirm(`Delete dish "${dish.name}"?`)) return;
    startTransition(async () => {
      await deleteDish(dish.id);
    });
  }

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      {/* Hidden id */}
      <input type="hidden" name="id" value={dish.id} />

      <DishFields categories={categories} defaultValues={dish} />

      <div className="flex items-center gap-2">
        <SubmitButton label="Save dish" />
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </form>
  );
}
