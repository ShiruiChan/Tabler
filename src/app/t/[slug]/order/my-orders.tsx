"use client";

import { useState, useTransition } from "react";
import { cancelMyOrder } from "@/lib/order-actions";
import type { OrderWithItems } from "@/lib/order-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  rub: "₽",
};

function formatCents(cents: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function formatOrderDate(isoUtc: string): string {
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

const ORDER_TYPE_LABELS: Record<string, string> = {
  in_session: "В заведении",
  delivery: "Доставка",
  banquet: "Банкет",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждён",
  preparing: "Готовится",
  ready: "Готов",
  out_for_delivery: "В доставке",
  completed: "Выполнен",
  cancelled: "Отменён",
  refunded: "Возврат",
};

const STATUS_BG: Record<string, string> = {
  pending: "rgba(202,138,4,0.15)",
  confirmed: "rgba(59,130,246,0.15)",
  preparing: "rgba(59,130,246,0.15)",
  ready: "rgba(22,163,74,0.15)",
  out_for_delivery: "rgba(59,130,246,0.15)",
  completed: "rgba(22,163,74,0.15)",
  cancelled: "rgba(107,114,128,0.15)",
  refunded: "rgba(107,114,128,0.15)",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "#92400e",
  confirmed: "#1e40af",
  preparing: "#1e40af",
  ready: "#166534",
  out_for_delivery: "#1e40af",
  completed: "#166534",
  cancelled: "#374151",
  refunded: "#374151",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MyOrdersProps {
  orders: OrderWithItems[];
}

// ---------------------------------------------------------------------------
// CancelButton - per-row cancel with useTransition (mirrors CancelButton in my-tickets.tsx)
// ---------------------------------------------------------------------------

function CancelButton({ orderId }: { orderId: string }) {
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
    if (!confirm("Отменить заказ? Это действие нельзя отменить.")) return;
    startTransition(async () => {
      const res = await cancelMyOrder(orderId);
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
          className="text-xs text-right max-w-[180px]"
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
// MyOrders - server-passed list, cancel interactions are client-side
// ---------------------------------------------------------------------------

export function MyOrders({ orders }: MyOrdersProps) {
  if (orders.length === 0) {
    return (
      <p
        className="text-sm"
        style={{ color: "var(--color-primary)", opacity: 0.6 }}
      >
        У вас пока нет заказов.
      </p>
    );
  }

  return (
    <ul className="space-y-5">
      {orders.map((order) => {
        const statusLabel = STATUS_LABELS[order.status] ?? order.status;
        const statusBg = STATUS_BG[order.status] ?? "rgba(0,0,0,0.06)";
        const statusColor = STATUS_TEXT[order.status] ?? "inherit";
        const typeLabel =
          ORDER_TYPE_LABELS[order.order_type] ?? order.order_type;
        const canCancel = order.status === "pending";

        return (
          <li
            key={order.id}
            className="rounded-2xl border bg-white/60 p-4 space-y-3 shadow-sm"
            style={{ borderColor: "rgba(0,0,0,0.07)" }}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p
                  className="font-heading text-sm font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  #{order.id.slice(0, 8).toUpperCase()}{" "}
                  <span
                    className="font-normal text-xs"
                    style={{ opacity: 0.55 }}
                  >
                    {typeLabel}
                  </span>
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "var(--color-primary)", opacity: 0.55 }}
                >
                  {formatOrderDate(order.created_at)}
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
                {canCancel && <CancelButton orderId={order.id} />}
              </div>
            </div>

            {/* Items */}
            {order.items.length > 0 && (
              <ul className="space-y-1">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex justify-between text-xs"
                    style={{ color: "var(--color-primary)", opacity: 0.75 }}
                  >
                    <span>
                      {item.dish_name}{" "}
                      <span style={{ opacity: 0.65 }}>× {item.quantity}</span>
                    </span>
                    <span>
                      {formatCents(
                        item.unit_price_cents * item.quantity,
                        order.currency
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Totals */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 text-xs border-t pt-2"
              style={{
                borderColor: "rgba(0,0,0,0.08)",
                color: "var(--color-primary)",
              }}
            >
              <span style={{ opacity: 0.65 }}>
                {order.order_type === "delivery" &&
                  order.delivery_fee_cents > 0 &&
                  `Доставка: ${formatCents(
                    order.delivery_fee_cents,
                    order.currency
                  )} · `}
                {order.order_type === "delivery" &&
                  order.delivery_address && (
                    <span>
                      {order.delivery_address.length > 40
                        ? order.delivery_address.slice(0, 40) + "…"
                        : order.delivery_address}
                    </span>
                  )}
              </span>
              <span className="font-semibold">
                Итого:{" "}
                <span style={{ color: "var(--color-accent)" }}>
                  {formatCents(order.total_cents, order.currency)}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
