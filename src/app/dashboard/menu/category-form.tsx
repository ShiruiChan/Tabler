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
// Submit button (needs useFormStatus - must be its own component)
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
// Create-category form
// ---------------------------------------------------------------------------

const createInitialState: MenuActionState = null;

export function CreateCategoryForm() {
  const [state, formAction] = useFormState(createCategory, createInitialState);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-rose-300">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="create-cat-name" className="label-dark">
            Название категории
          </label>
          <input
            id="create-cat-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="напр. Закуски"
            className="input-dark"
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <label htmlFor="create-cat-desc" className="label-dark">
            Описание <span className="text-slate-500">(необязательно)</span>
          </label>
          <input
            id="create-cat-desc"
            name="description"
            type="text"
            maxLength={500}
            placeholder="Краткое описание"
            className="input-dark"
          />
        </div>

        <div className="w-24">
          <label htmlFor="create-cat-sort" className="label-dark">
            Порядок
          </label>
          <input
            id="create-cat-sort"
            name="sort_order"
            type="number"
            min={0}
            defaultValue={0}
            className="input-dark"
          />
        </div>

        <SubmitButton label="Добавить категорию" />
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
        `Удалить категорию «${category.name}»? Все блюда в ней также будут удалены.`
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
        <p role="alert" className="text-xs text-rose-300">
          {state.error}
        </p>
      )}

      {/* Hidden id field */}
      <input type="hidden" name="id" value={category.id} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label htmlFor={`edit-cat-name-${category.id}`} className="label-dark">
            Название
          </label>
          <input
            id={`edit-cat-name-${category.id}`}
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={category.name}
            className="input-dark"
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <label htmlFor={`edit-cat-desc-${category.id}`} className="label-dark">
            Описание
          </label>
          <input
            id={`edit-cat-desc-${category.id}`}
            name="description"
            type="text"
            maxLength={500}
            defaultValue={category.description ?? ""}
            className="input-dark"
          />
        </div>

        <div className="w-24">
          <label htmlFor={`edit-cat-sort-${category.id}`} className="label-dark">
            Порядок
          </label>
          <input
            id={`edit-cat-sort-${category.id}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={category.sort_order}
            className="input-dark"
          />
        </div>

        {/* is_active toggle */}
        <div className="flex items-center gap-2 pb-1">
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
            className="h-4 w-4 rounded border-white/20 bg-white/5 text-amber-500 accent-amber-500"
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
            className="text-xs font-medium text-slate-300"
          >
            Активна
          </label>
        </div>

        <div className="flex items-end gap-2 pb-1">
          <SubmitButton label="Сохранить" />
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="btn-danger"
          >
            {isPending ? "Удаление…" : "Удалить"}
          </button>
        </div>
      </div>
    </form>
  );
}
