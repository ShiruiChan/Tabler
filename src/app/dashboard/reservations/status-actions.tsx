"use client";

import { useState, useTransition } from "react";
import { staffUpdateReservationStatus } from "@/lib/reservation-actions";
import type { ReservationStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allowed status transitions for a given current status. */
function allowedTransitions(current: ReservationStatus): ReservationStatus[] {
  switch (current) {
    case "pending":
      return ["confirmed", "cancelled"];
    case "confirmed":
      return ["completed", "no_show", "cancelled"];
    default:
      return []; // terminal: cancelled, completed, no_show
  }
}

const TRANSITION_LABELS: Record<ReservationStatus, string> = {
  confirmed: "Подтвердить",
  cancelled: "Отменить",
  completed: "Завершить",
  no_show:   "Не пришли",
  pending:   "Ожидает",
};

const TRANSITION_CLASSES: Record<ReservationStatus, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25",
  cancelled: "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30 hover:bg-slate-500/25",
  completed: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30 hover:bg-sky-500/25",
  no_show:   "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25",
  pending:   "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/25",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatusActionsProps {
  reservationId: string;
  currentStatus: ReservationStatus;
}

// ---------------------------------------------------------------------------
// StatusActions - per-row client island
// ---------------------------------------------------------------------------

export function StatusActions({ reservationId, currentStatus }: StatusActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const transitions = allowedTransitions(currentStatus);

  if (transitions.length === 0) {
    return (
      <span className="text-xs text-slate-500 italic">Нет действий</span>
    );
  }

  function handleTransition(newStatus: ReservationStatus) {
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("id", reservationId);
      fd.set("status", newStatus);
      const result = await staffUpdateReservationStatus(null, fd);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="flex flex-wrap gap-1">
        {transitions.map((status) => (
          <button
            key={status}
            type="button"
            disabled={isPending}
            onClick={() => handleTransition(status)}
            className={`rounded px-2 py-1 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${TRANSITION_CLASSES[status]}`}
          >
            {isPending ? "…" : TRANSITION_LABELS[status]}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-rose-400 mt-0.5" role="alert">{error}</p>
      )}
    </div>
  );
}


