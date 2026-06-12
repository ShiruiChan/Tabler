"use client";

import { useState, useTransition } from "react";
import { updateReservationSettings } from "@/lib/reservation-actions";
import type { ReservationSettings } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SettingsFormProps {
  settings: ReservationSettings | null;
}

// ---------------------------------------------------------------------------
// SettingsForm — single-save form for reservation_settings scalars
// ---------------------------------------------------------------------------

export function SettingsForm({ settings }: SettingsFormProps) {
  const [error, setError]   = useState<string | null>(null);
  const [saved, setSaved]   = useState(false);
  const [isPending, startTransition] = useTransition();

  const [maxParty,   setMaxParty]   = useState(String(settings?.max_party_size           ?? 12));
  const [minAdv,     setMinAdv]     = useState(String(settings?.min_advance_minutes       ?? 60));
  const [maxAdv,     setMaxAdv]     = useState(String(settings?.max_advance_days          ?? 60));
  const [duration,   setDuration]   = useState(String(settings?.default_duration_minutes  ?? 90));

  function handleSave() {
    startTransition(async () => {
      setError(null);
      setSaved(false);

      const fd = new FormData();
      fd.set("max_party_size",           maxParty);
      fd.set("min_advance_minutes",      minAdv);
      fd.set("max_advance_days",         maxAdv);
      fd.set("default_duration_minutes", duration);

      const result = await updateReservationSettings(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Max party size */}
        <div>
          <label
            htmlFor="rs_max_party"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Max party size (1–100)
          </label>
          <input
            id="rs_max_party"
            type="number"
            min={1}
            max={100}
            value={maxParty}
            onChange={(e) => setMaxParty(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        {/* Default duration */}
        <div>
          <label
            htmlFor="rs_duration"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Default booking duration (15–480 min)
          </label>
          <input
            id="rs_duration"
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        {/* Min advance minutes */}
        <div>
          <label
            htmlFor="rs_min_adv"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Min advance notice (minutes, ≥ 0)
          </label>
          <input
            id="rs_min_adv"
            type="number"
            min={0}
            value={minAdv}
            onChange={(e) => setMinAdv(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        {/* Max advance days */}
        <div>
          <label
            htmlFor="rs_max_adv"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Max advance window (days, ≥ 0)
          </label>
          <input
            id="rs_max_adv"
            type="number"
            min={0}
            value={maxAdv}
            onChange={(e) => setMaxAdv(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isPending ? "Saving…" : saved ? "Saved!" : "Save settings"}
        </button>
        {saved && (
          <span className="text-sm text-green-600" aria-live="polite">
            Settings saved.
          </span>
        )}
      </div>
    </div>
  );
}
