"use client";

import { useState, useTransition } from "react";
import { cancelMyTicket } from "@/lib/event-actions";
import type { EventTicketWithEvent } from "@/lib/event-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  rub: "₽",
};

function formatEventDatetime(isoUtc: string): string {
  const d = new Date(isoUtc);
  const date = d.toLocaleDateString("ru-RU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date} в ${hh}:${mm} UTC`;
}

function formatTicketTotal(priceCents: number, currency: string, qty: number): string {
  if (priceCents === 0) return "Бесплатно";
  const sym = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${((priceCents * qty) / 100).toFixed(2)}`;
}

const STATUS_LABELS: Record<string, string> = {
  reserved: "Забронирован",
  paid: "Оплачен",
  cancelled: "Отменён",
  refunded: "Возврат",
};

const STATUS_COLORS: Record<string, string> = {
  reserved: "rgba(202,138,4,0.15)",  // amber tint
  paid: "rgba(22,163,74,0.15)",       // green tint
  cancelled: "rgba(107,114,128,0.15)",// grey tint
  refunded: "rgba(107,114,128,0.15)", // grey tint
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  reserved: "#92400e",
  paid: "#166534",
  cancelled: "#374151",
  refunded: "#374151",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MyTicketsProps {
  tickets: EventTicketWithEvent[];
}

// ---------------------------------------------------------------------------
// CancelButton - per-row pending state (TASK-021 pattern)
// ---------------------------------------------------------------------------

function CancelButton({ ticketId }: { ticketId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (cancelled) {
    return (
      <span
        className="text-xs"
        style={{ color: "var(--color-primary)", opacity: 0.5 }}
      >
        Отменён
      </span>
    );
  }

  function handleCancel() {
    if (!confirm("Отменить билет? Это действие нельзя отменить.")) return;
    startTransition(async () => {
      const res = await cancelMyTicket(ticketId);
      if (res === null) {
        setCancelled(true);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCancel}
        disabled={isPending}
        className="rounded-md px-3 py-1 text-xs font-medium border transition hover:opacity-75 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          borderColor: "rgba(220,38,38,0.4)",
          color: "rgb(220,38,38)",
        }}
      >
        {isPending ? "Отмена…" : "Отменить"}
      </button>
      {error && (
        <span
          className="text-xs text-right max-w-[160px]"
          role="alert"
          style={{ color: "rgb(220,38,38)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MyTickets - server-passed list, cancel interactions are client-side
// ---------------------------------------------------------------------------

export function MyTickets({ tickets }: MyTicketsProps) {
  if (tickets.length === 0) {
    return (
      <p
        className="text-sm"
        style={{ color: "var(--color-primary)", opacity: 0.6 }}
      >
        У вас пока нет билетов.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {tickets.map((ticket) => {
        const total = formatTicketTotal(
          ticket.unit_price_cents,
          ticket.currency,
          ticket.quantity
        );
        const statusLabel = STATUS_LABELS[ticket.status] ?? ticket.status;
        const statusBg = STATUS_COLORS[ticket.status] ?? "rgba(0,0,0,0.06)";
        const statusColor = STATUS_TEXT_COLORS[ticket.status] ?? "inherit";
        const canCancel = ticket.status === "reserved";

        return (
          <li
            key={ticket.id}
            className="flex items-start justify-between gap-4 rounded-2xl border bg-white/60 p-4 shadow-sm"
            style={{ borderColor: "rgba(0,0,0,0.07)" }}
          >
            <div className="flex-1 min-w-0">
              <p
                className="font-heading text-sm font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                {ticket.event.title}
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: "var(--color-primary)", opacity: 0.65 }}
              >
                {formatEventDatetime(ticket.event.starts_at)}
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-primary)", opacity: 0.75 }}
              >
                Билетов: {ticket.quantity} · {total}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Status badge */}
              <span
                className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: statusBg,
                  color: statusColor,
                }}
              >
                {statusLabel}
              </span>

              {/* Cancel button - only for reserved tickets */}
              {canCancel && <CancelButton ticketId={ticket.id} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
