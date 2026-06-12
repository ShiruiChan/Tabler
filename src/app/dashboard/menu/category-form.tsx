"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTransition } from "react";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/menu-actions";
import type { MenuActionState } from "@/lib/menu-actions";
import type { MenuCategory } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Submit button (needs useFormStatus — must be its own component)
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
// Create-category form
// ---------------------------------------------------------------------------

const createInitialState: MenuActionState = null;

export function CreateCategoryForm() {
  const [state, formAction] = useFormState(createCategory, createInitialState);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label
            htmlFor="create-cat-name"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Category name
          </label>
          <input
            id="create-cat-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="e.g. Starters"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <label
            htmlFor="create-cat-desc"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Description <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="create-cat-desc"
            name="description"
            type="text"
            maxLength={500}
            placeholder="Short description"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <div className="w-24">
          <label
            htmlFor="create-cat-sort"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Order
          </label>
          <input
            id="create-cat-sort"
            name="sort_order"
            type="number"
            min={0}
            defaultValue={0}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <SubmitButton label="Add category" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit-category form
// ---------------------------------------------------------------------------

interface EditCategoryFormProps {
  category: MenuCategory;
}

const editInitialState: MenuActionState = null;

export function EditCategoryForm({ category }: EditCategoryFormProps) {
  const [state, formAction] = useFormState(updateCategory, editInitialState);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (
      !confirm(
        `Delete category "${category.name}"? All dishes in it will also be deleted.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteCategory(category.id);
    });
  }

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      {/* Hidden id field */}
      <input type="hidden" name="id" value={category.id} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label
            htmlFor={`edit-cat-name-${category.id}`}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Name
          </label>
          <input
            id={`edit-cat-name-${category.id}`}
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={category.name}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <label
            htmlFor={`edit-cat-desc-${category.id}`}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Description
          </label>
          <input
            id={`edit-cat-desc-${category.id}`}
            name="description"
            type="text"
            maxLength={500}
            defaultValue={category.description ?? ""}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <div className="w-24">
          <label
            htmlFor={`edit-cat-sort-${category.id}`}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Order
          </label>
          <input
            id={`edit-cat-sort-${category.id}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={category.sort_order}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* is_active toggle */}
        <div className="flex items-center gap-2 pb-0.5">
          <input
            id={`edit-cat-active-${category.id}`}
            name="is_active"
            type="checkbox"
            value="true"
            defaultChecked={category.is_active}
            onChange={(e) => {
              // Ensure the hidden sibling reflects unchecked state
              const hiddenInput =
                e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                  'input[type="hidden"][name="is_active"]'
                );
              if (hiddenInput) {
                hiddenInput.disabled = e.currentTarget.checked;
              }
            }}
            className="h-4 w-4 rounded border-gray-300"
          />
          {/* When checkbox is unchecked it submits no value; the hidden field
              submits "false" as fallback so the server sees is_active=false */}
          <input
            type="hidden"
            name="is_active"
            value="false"
            disabled={category.is_active}
          />
          <label
            htmlFor={`edit-cat-active-${category.id}`}
            className="text-xs font-medium text-gray-600"
          >
            Active
          </label>
        </div>

        <div className="flex items-end gap-2 pb-0.5">
          <SubmitButton label="Save" />
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </form>
  );
}
