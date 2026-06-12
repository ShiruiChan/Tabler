"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDeliveryZone,
  updateDeliveryZone,
  deleteDeliveryZone,
} from "@/lib/delivery-actions";
import type { DeliveryZone } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents as major-unit decimal string for <input> default values. */
function centsToMajor(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

/** Serialize polygon to pretty JSON string for textarea display. */
function polygonToJson(polygon: DeliveryZone["polygon"]): string {
  if (!polygon) return "";
  return JSON.stringify(polygon);
}

// ---------------------------------------------------------------------------
// Shared zone fields
// ---------------------------------------------------------------------------

interface ZoneFieldsProps {
  id?: string; // present for edit, absent for create
  defaults?: Partial<DeliveryZone>;
}

function ZoneFields({ id, defaults }: ZoneFieldsProps) {
  // Checkbox controlled state for is_active (hidden-field pattern — TASK-013/014)
  const [isActive, setIsActive] = useState<boolean>(defaults?.is_active ?? true);

  return (
    <div className="space-y-3">
      {id && <input type="hidden" name="id" value={id} />}

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Zone name
        </label>
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={defaults?.name ?? ""}
          placeholder="e.g. City Centre"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      {/* Money overrides + sort_order row */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Fee override{" "}
            <span className="text-gray-400">(optional)</span>
          </label>
          <input
            name="fee_override_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(defaults?.fee_override_cents)}
            placeholder="e.g. 2.50"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">Blank = use base fee</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Min order override{" "}
            <span className="text-gray-400">(optional)</span>
          </label>
          <input
            name="min_order_override_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(defaults?.min_order_override_cents)}
            placeholder="e.g. 15.00"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">Blank = use global minimum</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Sort order
          </label>
          <input
            name="sort_order"
            type="number"
            step={1}
            defaultValue={defaults?.sort_order ?? 0}
            className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
      </div>

      {/* is_active — checkbox hidden-field pattern (TASK-013/014) */}
      <div className="flex items-center gap-2">
        <input
          id={`is-active-${id ?? "new"}`}
          name="is_active"
          type="checkbox"
          value="true"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <input
          type="hidden"
          name="is_active"
          value="false"
          disabled={isActive}
        />
        <label
          htmlFor={`is-active-${id ?? "new"}`}
          className="text-xs font-medium text-gray-600"
        >
          Active
        </label>
      </div>

      {/* Polygon */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Polygon{" "}
          <span className="text-gray-400">
            (optional JSON array of [lng,lat] pairs, ≥3 points)
          </span>
        </label>
        <textarea
          name="polygon_json"
          rows={3}
          defaultValue={polygonToJson(defaults?.polygon ?? null)}
          placeholder={'e.g. [[-0.12,51.51],[-0.11,51.51],[-0.11,51.50],[-0.12,51.50]]'}
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-mono focus:border-gray-900 focus:outline-none"
        />
        <p className="mt-0.5 text-xs text-gray-400">
          Leave blank for a named zone without a map boundary.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateZoneForm
// ---------------------------------------------------------------------------

export function CreateZoneForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      setError(null);
      const result = await createDeliveryZone(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-dashed border-gray-300 p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Add zone
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <ZoneFields />

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create zone"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// EditZoneForm
// ---------------------------------------------------------------------------

interface EditZoneFormProps {
  zone: DeliveryZone;
}

export function EditZoneForm({ zone }: EditZoneFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      setError(null);
      const result = await updateDeliveryZone(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Delete zone "${zone.name}"? This cannot be undone. Existing orders linked to this zone will have their zone reference cleared.`
      )
    ) {
      return;
    }
    startDeleteTransition(async () => {
      setDeleteError(null);
      const result = await deleteDeliveryZone(zone.id);
      if (result?.error) {
        setDeleteError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="text-xs text-red-600">
          {deleteError}
        </p>
      )}

      <ZoneFields id={zone.id} defaults={zone} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || isDeleting}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save zone"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending || isDeleting}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </form>
  );
}
