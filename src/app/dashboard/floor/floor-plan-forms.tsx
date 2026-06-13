"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTransition } from "react";
import {
  createFloorPlan,
  updateFloorPlan,
  deleteFloorPlan,
} from "@/lib/floor-actions";
import type { FloorActionState } from "@/lib/floor-actions";
import type { FloorPlan } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Submit button - must be its own component to use useFormStatus
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
// Create floor plan form
// ---------------------------------------------------------------------------

const createInitialState: FloorActionState = null;

function CreateFloorPlanForm() {
  const [state, formAction] = useFormState(createFloorPlan, createInitialState);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* Name */}
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="create-floor-name" className="label-dark">
            Название
          </label>
          <input
            id="create-floor-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="Например, Главный зал"
            className="input-dark"
          />
        </div>

        {/* Width */}
        <div className="w-28">
          <label htmlFor="create-floor-width" className="label-dark">
            Ширина <span className="text-slate-500">(px)</span>
          </label>
          <input
            id="create-floor-width"
            name="width"
            type="number"
            min={100}
            max={10000}
            defaultValue={1000}
            className="input-dark"
          />
        </div>

        {/* Height */}
        <div className="w-28">
          <label htmlFor="create-floor-height" className="label-dark">
            Высота <span className="text-slate-500">(px)</span>
          </label>
          <input
            id="create-floor-height"
            name="height"
            type="number"
            min={100}
            max={10000}
            defaultValue={700}
            className="input-dark"
          />
        </div>

        <SubmitButton label="Добавить схему" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit floor plan form
// ---------------------------------------------------------------------------

interface EditFloorPlanFormProps {
  plan: FloorPlan;
}

const editInitialState: FloorActionState = null;

function EditFloorPlanForm({ plan }: EditFloorPlanFormProps) {
  const [state, formAction] = useFormState(updateFloorPlan, editInitialState);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (
      !confirm(
        `Удалить схему «${plan.name}»? Все зоны столов также будут удалены. Это действие необратимо.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteFloorPlan(plan.id);
    });
  }

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      )}

      {/* Hidden id */}
      <input type="hidden" name="id" value={plan.id} />

      <div className="flex flex-wrap items-end gap-3">
        {/* Name */}
        <div className="flex-1 min-w-[180px]">
          <label htmlFor={`edit-floor-name-${plan.id}`} className="label-dark">
            Название
          </label>
          <input
            id={`edit-floor-name-${plan.id}`}
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={plan.name}
            className="input-dark"
          />
        </div>

        {/* Sort order */}
        <div className="w-24">
          <label htmlFor={`edit-floor-sort-${plan.id}`} className="label-dark">
            Порядок
          </label>
          <input
            id={`edit-floor-sort-${plan.id}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={plan.sort_order}
            className="input-dark"
          />
        </div>

        {/* is_active toggle - matches the pattern from category-form.tsx */}
        <div className="flex items-center gap-2 pb-2">
          <input
            id={`edit-floor-active-${plan.id}`}
            name="is_active"
            type="checkbox"
            value="true"
            defaultChecked={plan.is_active}
            onChange={(e) => {
              const hiddenInput =
                e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                  'input[type="hidden"][name="is_active"]'
                );
              if (hiddenInput) {
                hiddenInput.disabled = e.currentTarget.checked;
              }
            }}
            className="h-4 w-4 rounded border-white/20 bg-white/5 accent-amber-500"
          />
          <input
            type="hidden"
            name="is_active"
            value="false"
            disabled={plan.is_active}
          />
          <label
            htmlFor={`edit-floor-active-${plan.id}`}
            className="text-xs font-medium text-slate-300"
          >
            Активна
          </label>
        </div>

        <div className="flex items-end gap-2 pb-0.5">
          <SubmitButton label="Сохранить" />
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="btn-danger"
          >
            {isPending ? "Удаление…" : "Удалить схему"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Named export bundle
// ---------------------------------------------------------------------------

export const FloorPlanForms = {
  Create: CreateFloorPlanForm,
  Edit: EditFloorPlanForm,
};
