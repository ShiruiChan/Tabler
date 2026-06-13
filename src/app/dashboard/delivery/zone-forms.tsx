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
  // Checkbox controlled state for is_active (hidden-field pattern - TASK-013/014)
  const [isActive, setIsActive] = useState<boolean>(defaults?.is_active ?? true);

  return (
    <div className="space-y-3">
      {id && <input type="hidden" name="id" value={id} />}

      {/* Name */}
      <div>
        <label className="label-dark">
          Название зоны
        </label>
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={defaults?.name ?? ""}
          placeholder="Например, Центр города"
          className="input-dark"
        />
      </div>

      {/* Money overrides + sort_order row */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="label-dark">
            Своя стоимость{" "}
            <span className="text-slate-500">(необязательно)</span>
          </label>
          <input
            name="fee_override_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(defaults?.fee_override_cents)}
            placeholder="например, 2.50"
            className="input-dark w-32"
          />
          <p className="field-hint">Пусто = базовая стоимость</p>
        </div>

        <div>
          <label className="label-dark">
            Свой мин. заказ{" "}
            <span className="text-slate-500">(необязательно)</span>
          </label>
          <input
            name="min_order_override_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(defaults?.min_order_override_cents)}
            placeholder="например, 15.00"
            className="input-dark w-32"
          />
          <p className="field-hint">Пусто = общий минимум</p>
        </div>

        <div>
          <label className="label-dark">
            Порядок
          </label>
          <input
            name="sort_order"
            type="number"
            step={1}
            defaultValue={defaults?.sort_order ?? 0}
            className="input-dark w-24"
          />
        </div>
      </div>

      {/* is_active - checkbox hidden-field pattern (TASK-013/014) */}
      <div className="flex items-center gap-2">
        <input
          id={`is-active-${id ?? "new"}`}
          name="is_active"
          type="checkbox"
          value="true"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-white/5 accent-amber-500"
        />
        <input
          type="hidden"
          name="is_active"
          value="false"
          disabled={isActive}
        />
        <label
          htmlFor={`is-active-${id ?? "new"}`}
          className="text-xs font-medium text-slate-300"
        >
          Активна
        </label>
      </div>

      {/* Polygon */}
      <div>
        <label className="label-dark">
          Полигон{" "}
          <span className="text-slate-500">
            (необязательный JSON-массив пар [lng,lat], ≥3 точек)
          </span>
        </label>
        <textarea
          name="polygon_json"
          rows={3}
          defaultValue={polygonToJson(defaults?.polygon ?? null)}
          placeholder={'например, [[-0.12,51.51],[-0.11,51.51],[-0.11,51.50],[-0.12,51.50]]'}
          className="input-dark font-mono text-xs"
        />
        <p className="field-hint">
          Оставьте пустым для именованной зоны без границы на карте.
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
      className="space-y-3 rounded-md border border-dashed border-white/15 p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Добавить зону
      </p>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      <ZoneFields />

      <div>
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Создание…" : "Создать зону"}
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
        `Удалить зону «${zone.name}»? Это действие необратимо. У существующих заказов, привязанных к этой зоне, ссылка на зону будет очищена.`
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
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="alert-error">
          {deleteError}
        </p>
      )}

      <ZoneFields id={zone.id} defaults={zone} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || isDeleting}
          className="btn-primary"
        >
          {isPending ? "Сохранение…" : "Сохранить зону"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending || isDeleting}
          className="btn-danger"
        >
          {isDeleting ? "Удаление…" : "Удалить"}
        </button>
      </div>
    </form>
  );
}
