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
// SettingsForm - single-save form for reservation_settings scalars
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
          <label htmlFor="rs_max_party" className="label-dark">
            Макс. размер компании (1–100)
          </label>
          <input
            id="rs_max_party"
            type="number"
            min={1}
            max={100}
            value={maxParty}
            onChange={(e) => setMaxParty(e.target.value)}
            className="input-dark"
          />
        </div>

        {/* Default duration */}
        <div>
          <label htmlFor="rs_duration" className="label-dark">
            Длительность брони по умолчанию (15–480 мин)
          </label>
          <input
            id="rs_duration"
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="input-dark"
          />
        </div>

        {/* Min advance minutes */}
        <div>
          <label htmlFor="rs_min_adv" className="label-dark">
            Мин. срок заблаговременной брони (мин, ≥ 0)
          </label>
          <input
            id="rs_min_adv"
            type="number"
            min={0}
            value={minAdv}
            onChange={(e) => setMinAdv(e.target.value)}
            className="input-dark"
          />
        </div>

        {/* Max advance days */}
        <div>
          <label htmlFor="rs_max_adv" className="label-dark">
            Макс. окно брони наперёд (дней, ≥ 0)
          </label>
          <input
            id="rs_max_adv"
            type="number"
            min={0}
            value={maxAdv}
            onChange={(e) => setMaxAdv(e.target.value)}
            className="input-dark"
          />
        </div>
      </div>

      {error && (
        <p className="alert-error" role="alert">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="btn-primary"
        >
          {isPending ? "Сохранение…" : saved ? "Сохранено!" : "Сохранить настройки"}
        </button>
        {saved && (
          <span className="text-sm text-emerald-400" aria-live="polite">
            Настройки сохранены.
          </span>
        )}
      </div>
    </div>
  );
}
