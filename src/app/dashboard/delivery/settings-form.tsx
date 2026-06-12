"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeliverySettings } from "@/lib/delivery-actions";
import type { DeliverySettings, DeliveryScheduleDay } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// Display order Mon–Sun, then Sun at end matches the reservations pattern.
// We show Sun–Sat (0–6) in ascending order to match schedule key convention.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents as major-unit decimal string for <input> default values. */
function centsToMajor(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Per-day schedule row (uncontrolled within the settings form)
// ---------------------------------------------------------------------------

interface ScheduleRowProps {
  day: number;
  initial: DeliveryScheduleDay | undefined;
}

function ScheduleRow({ day, initial }: ScheduleRowProps) {
  const [isClosed, setIsClosed] = useState<boolean>(initial?.closed ?? true);
  const [openTime, setOpenTime] = useState<string>(initial?.open ?? "10:00");
  const [closeTime, setCloseTime] = useState<string>(initial?.close ?? "22:00");

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
      {/* Hidden fields carry the values into the parent form */}
      <input type="hidden" name={`schedule_${day}_closed`} value={isClosed ? "true" : "false"} />
      <input type="hidden" name={`schedule_${day}_open`} value={openTime} />
      <input type="hidden" name={`schedule_${day}_close`} value={closeTime} />

      <span className="w-24 shrink-0 text-sm font-medium text-gray-900">
        {WEEKDAY_LABELS[day]}
      </span>

      {/* Closed toggle */}
      <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={isClosed}
          onChange={(e) => setIsClosed(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300"
        />
        Closed
      </label>

      {/* Time inputs — dimmed when closed */}
      <div
        className={`flex flex-wrap items-center gap-2 ${
          isClosed ? "pointer-events-none opacity-40" : ""
        }`}
      >
        <label className="flex items-center gap-1 text-xs text-gray-500">
          Open (UTC)
          <input
            type="time"
            value={openTime}
            onChange={(e) => setOpenTime(e.target.value)}
            className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          Close (UTC)
          <input
            type="time"
            value={closeTime}
            onChange={(e) => setCloseTime(e.target.value)}
            className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeliverySettingsForm
// ---------------------------------------------------------------------------

interface DeliverySettingsFormProps {
  settings: DeliverySettings;
}

export function DeliverySettingsForm({ settings }: DeliverySettingsFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Checkbox controlled state for is_enabled (hidden-field pattern — TASK-013/014)
  const [isEnabled, setIsEnabled] = useState<boolean>(settings.is_enabled);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    startTransition(async () => {
      setError(null);
      setSaved(false);
      const result = await updateDeliverySettings(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        router.refresh();
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {/* is_enabled — checkbox hidden-field pattern */}
      <div className="flex items-center gap-2">
        <input
          id="is-enabled"
          name="is_enabled"
          type="checkbox"
          value="true"
          checked={isEnabled}
          onChange={(e) => setIsEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <input
          type="hidden"
          name="is_enabled"
          value="false"
          disabled={isEnabled}
        />
        <label htmlFor="is-enabled" className="text-sm font-medium text-gray-700">
          Enable delivery
        </label>
      </div>

      {/* Currency */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Currency
        </label>
        <select
          name="currency"
          defaultValue={settings.currency}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
        >
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
          <option value="gbp">GBP</option>
          <option value="rub">RUB</option>
        </select>
      </div>

      {/* Money fields */}
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Minimum order
          </label>
          <input
            name="min_order_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(settings.min_order_cents)}
            placeholder="0.00"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">0 = no minimum</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Base delivery fee
          </label>
          <input
            name="base_fee_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(settings.base_fee_cents)}
            placeholder="0.00"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">0 = free</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Free delivery over{" "}
            <span className="text-gray-400">(optional)</span>
          </label>
          <input
            name="free_delivery_over_cents"
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToMajor(settings.free_delivery_over_cents)}
            placeholder="e.g. 30.00"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">Leave blank to disable</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Estimated delivery{" "}
            <span className="text-gray-400">(min, optional)</span>
          </label>
          <input
            name="estimated_minutes"
            type="number"
            min={5}
            max={480}
            step={1}
            defaultValue={settings.estimated_minutes ?? ""}
            placeholder="e.g. 45"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-400">5–480 min; blank = not shown</p>
        </div>
      </div>

      {/* Schedule editor */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Delivery hours (UTC)
        </p>
        <div className="space-y-2">
          {DISPLAY_ORDER.map((day) => (
            <ScheduleRow
              key={day}
              day={day}
              initial={settings.schedule[String(day) as keyof typeof settings.schedule]}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          All times are UTC. Missing days are treated as closed.
        </p>
      </div>

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : saved ? "Saved!" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
