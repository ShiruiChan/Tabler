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
  confirmed: "Confirm",
  cancelled: "Cancel",
  completed: "Complete",
  no_show:   "No-show",
  pending:   "Pending",
};

const TRANSITION_CLASSES: Record<ReservationStatus, string> = {
  confirmed: "bg-green-600 hover:bg-green-700 text-white",
  cancelled: "bg-gray-500 hover:bg-gray-600 text-white",
  completed: "bg-blue-600 hover:bg-blue-700 text-white",
  no_show:   "bg-red-600 hover:bg-red-700 text-white",
  pending:   "bg-amber-500 hover:bg-amber-600 text-white",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatusActionsProps {
  reservationId: string;
  currentStatus: ReservationStatus;
}

// ---------------------------------------------------------------------------
// StatusActions — per-row client island
// ---------------------------------------------------------------------------

export function StatusActions({ reservationId, currentStatus }: StatusActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const transitions = allowedTransitions(currentStatus);

  if (transitions.length === 0) {
    return (
      <span className="text-xs text-gray-400 italic">No actions</span>
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
        <p className="text-xs text-red-600 mt-0.5" role="alert">{error}</p>
      )}
    </div>
  );
}


