"use client";

import { useState, useTransition } from "react";
import { upsertAvailabilityRule } from "@/lib/reservation-actions";
import type { AvailabilityRule } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const;

// Ordered Mon–Sun for display (indices into WEEKDAY_LABELS).
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim "HH:MM:SS" DB time string to "HH:MM" for <input type="time"> value. */
function toTimeInput(dbTime: string | undefined): string {
  if (!dbTime) return "";
  return dbTime.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Single weekday row
// ---------------------------------------------------------------------------

interface WeekdayRowProps {
  weekday: number;
  rule: AvailabilityRule | undefined;
}

function WeekdayRow({ weekday, rule }: WeekdayRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Local controlled state so changes are reflected immediately.
  const [isClosed, setIsClosed] = useState<boolean>(rule?.is_closed ?? false);
  const [opensAt, setOpensAt] = useState<string>(toTimeInput(rule?.opens_at) || "09:00");
  const [closesAt, setClosesAt] = useState<string>(toTimeInput(rule?.closes_at) || "22:00");
  const [slotMinutes, setSlotMinutes] = useState<string>(String(rule?.slot_minutes ?? 30));
  const [lastSeating, setLastSeating] = useState<string>(String(rule?.last_seating_minutes ?? 90));

  function handleSave() {
    startTransition(async () => {
      setError(null);
      setSaved(false);

      const fd = new FormData();
      fd.set("weekday",              String(weekday));
      fd.set("opens_at",             opensAt);
      fd.set("closes_at",            closesAt);
      fd.set("slot_minutes",         slotMinutes);
      fd.set("last_seating_minutes", lastSeating);
      // Checkbox: only include when checked
      if (isClosed) fd.set("is_closed", "true");

      const result = await upsertAvailabilityRule(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      {/* Row header */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="w-28 shrink-0 text-sm font-medium text-slate-100">
          {WEEKDAY_LABELS[weekday]}
        </span>

        {/* Closed toggle */}
        <label className="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isClosed}
            onChange={(e) => setIsClosed(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-amber-500"
          />
          Закрыто
        </label>

        {/* Time inputs - dimmed when closed */}
        <div className={`flex items-center gap-2 flex-wrap ${isClosed ? "opacity-40 pointer-events-none" : ""}`}>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Открытие (UTC)
            <input
              type="time"
              value={opensAt}
              step={900}
              onChange={(e) => setOpensAt(e.target.value)}
              className="ml-1 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50 [color-scheme:dark]"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Закрытие (UTC)
            <input
              type="time"
              value={closesAt}
              step={900}
              onChange={(e) => setClosesAt(e.target.value)}
              className="ml-1 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50 [color-scheme:dark]"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Слот
            <select
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(e.target.value)}
              className="ml-1 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50 [color-scheme:dark]"
            >
              <option value="15">15 мин</option>
              <option value="30">30 мин</option>
              <option value="60">60 мин</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Последняя посадка
            <input
              type="number"
              min={0}
              max={480}
              value={lastSeating}
              onChange={(e) => setLastSeating(e.target.value)}
              className="ml-1 w-16 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
            />
            <span className="text-slate-600">мин до закрытия</span>
          </label>
        </div>

        {/* Save button */}
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="btn-primary ml-auto"
        >
          {isPending ? "Сохранение…" : saved ? "Сохранено!" : "Сохранить"}
        </button>
      </div>

      {error && (
        <p className="alert-error" role="alert">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AvailabilityForm - the 7-row weekday editor
// ---------------------------------------------------------------------------

export interface AvailabilityFormProps {
  rules: AvailabilityRule[];
}

export function AvailabilityForm({ rules }: AvailabilityFormProps) {
  const ruleByWeekday = new Map(rules.map((r) => [r.weekday, r]));

  return (
    <div className="space-y-2">
      {DISPLAY_ORDER.map((weekday) => (
        <WeekdayRow
          key={weekday}
          weekday={weekday}
          rule={ruleByWeekday.get(weekday)}
        />
      ))}
      <p className="field-hint pt-1">
        Всё время в UTC. Изменения сразу применяются к новым броням.
      </p>
    </div>
  );
}
