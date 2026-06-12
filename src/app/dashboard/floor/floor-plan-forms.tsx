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
// Submit button — must be its own component to use useFormStatus
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
// Create floor plan form
// ---------------------------------------------------------------------------

const createInitialState: FloorActionState = null;

function CreateFloorPlanForm() {
  const [state, formAction] = useFormState(createFloorPlan, createInitialState);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* Name */}
        <div className="flex-1 min-w-[180px]">
          <label
            htmlFor="create-floor-name"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Name
          </label>
          <input
            id="create-floor-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="e.g. Main Hall"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Width */}
        <div className="w-28">
          <label
            htmlFor="create-floor-width"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Width <span className="text-gray-400">(px)</span>
          </label>
          <input
            id="create-floor-width"
            name="width"
            type="number"
            min={100}
            max={10000}
            defaultValue={1000}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Height */}
        <div className="w-28">
          <label
            htmlFor="create-floor-height"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Height <span className="text-gray-400">(px)</span>
          </label>
          <input
            id="create-floor-height"
            name="height"
            type="number"
            min={100}
            max={10000}
            defaultValue={700}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        <SubmitButton label="Add plan" />
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
        `Delete floor plan "${plan.name}"? All table zones will also be deleted. This cannot be undone.`
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
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}

      {/* Hidden id */}
      <input type="hidden" name="id" value={plan.id} />

      <div className="flex flex-wrap items-end gap-3">
        {/* Name */}
        <div className="flex-1 min-w-[180px]">
          <label
            htmlFor={`edit-floor-name-${plan.id}`}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Name
          </label>
          <input
            id={`edit-floor-name-${plan.id}`}
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={plan.name}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Sort order */}
        <div className="w-24">
          <label
            htmlFor={`edit-floor-sort-${plan.id}`}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Order
          </label>
          <input
            id={`edit-floor-sort-${plan.id}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={plan.sort_order}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* is_active toggle — matches the pattern from category-form.tsx */}
        <div className="flex items-center gap-2 pb-0.5">
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
            className="h-4 w-4 rounded border-gray-300"
          />
          <input
            type="hidden"
            name="is_active"
            value="false"
            disabled={plan.is_active}
          />
          <label
            htmlFor={`edit-floor-active-${plan.id}`}
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
            {isPending ? "Deleting…" : "Delete plan"}
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
