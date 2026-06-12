"use client";

import { useState, useTransition } from "react";
import { staffUpdateTicketStatus } from "@/lib/event-actions";
import type { EventTicketStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EventTicketStatus, string> = {
  reserved:  "Reserved",
  paid:      "Paid",
  cancelled: "Cancelled",
  refunded:  "Refunded",
};

const STATUS_BADGE: Record<EventTicketStatus, string> = {
  reserved:  "bg-amber-100 text-amber-800",
  paid:      "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  refunded:  "bg-blue-100 text-blue-800",
};

const ALL_STATUSES: EventTicketStatus[] = ["reserved", "paid", "cancelled", "refunded"];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TicketStatusActionsProps {
  ticketId: string;
  tenantId: string;
  currentStatus: EventTicketStatus;
}

// ---------------------------------------------------------------------------
// Component — per-ticket client island (scoped pending state per ticket row)
// ---------------------------------------------------------------------------

export function TicketStatusActions({
  ticketId,
  tenantId,
  currentStatus,
}: TicketStatusActionsProps) {
  const [status, setStatus] = useState<EventTicketStatus>(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value as EventTicketStatus;
    if (newStatus === status) return;

    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("id", ticketId);
      fd.set("status", newStatus);
      fd.set("tenant_id", tenantId);
      const result = await staffUpdateTicketStatus(null, fd);
      if (result?.error) {
        setError(result.error);
        // Reset select back to previous value on failure
      } else {
        setStatus(newStatus);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="flex items-center gap-2">
        {/* Current status badge */}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>

        {/* Status select */}
        <select
          value={status}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Change ticket status"
          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {isPending && (
          <span className="text-xs text-gray-400">Saving…</span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
