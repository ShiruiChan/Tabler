"use client";

import { useState, useTransition } from "react";
import { staffUpdateTicketStatus } from "@/lib/event-actions";
import type { EventTicketStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EventTicketStatus, string> = {
  reserved:  "Забронировано",
  paid:      "Оплачено",
  cancelled: "Отменено",
  refunded:  "Возвращено",
};

const STATUS_BADGE: Record<EventTicketStatus, string> = {
  reserved:  "badge badge-amber",
  paid:      "badge badge-emerald",
  cancelled: "badge badge-slate",
  refunded:  "badge badge-sky",
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
// Component - per-ticket client island (scoped pending state per ticket row)
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
        <span className={STATUS_BADGE[status]}>
          {STATUS_LABELS[status]}
        </span>

        {/* Status select */}
        <select
          value={status}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Изменить статус билета"
          className="select-dark py-1 text-xs disabled:opacity-50"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {isPending && (
          <span className="text-xs text-slate-500">Сохранение…</span>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
