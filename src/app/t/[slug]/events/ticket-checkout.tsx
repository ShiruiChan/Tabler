"use client";

import { useState, useTransition } from "react";
import { purchaseTickets } from "@/lib/event-actions";
import type { PublicEventWithAvailability } from "@/lib/event-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  rub: "₽",
};

function formatTotal(cents: number, currency: string, quantity: number): string {
  if (cents === 0) return "Бесплатно";
  const sym = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase() + " ";
  return `${sym}${((cents * quantity) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TicketCheckoutProps {
  event: PublicEventWithAvailability;
  tenantId: string;
}

// ---------------------------------------------------------------------------
// TicketCheckout - client island per event
// ---------------------------------------------------------------------------

export function TicketCheckout({ event, tenantId }: TicketCheckoutProps) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [confirmedQty, setConfirmedQty] = useState(1);
  const [isPending, startTransition] = useTransition();

  const isFree = event.price_cents === 0;
  const isSoldOut = event.remaining === 0;
  const maxQty = Math.min(event.remaining, 100);

  // ── Open/close drawer ────────────────────────────────────────────────────
  function handleOpen() {
    setOpen(true);
    setError(null);
    setSucceeded(false);
    setQuantity(1);
  }

  function handleClose() {
    setOpen(false);
    setError(null);
    setSucceeded(false);
    setQuantity(1);
  }

  // ── Form submit ──────────────────────────────────────────────────────────
  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await purchaseTickets(null, formData);
      if (res === null) {
        setConfirmedQty(quantity);
        setError(null);
        setSucceeded(true);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Sold-out button ───────────────────────────────────────────────────────
  if (isSoldOut) {
    return (
      <span
        className="inline-block rounded-full px-5 py-2 text-sm font-semibold cursor-not-allowed opacity-50"
        style={{
          border: "1px solid var(--color-accent)",
          color: "var(--color-accent)",
        }}
        aria-disabled="true"
      >
        Билеты распроданы
      </span>
    );
  }

  // ── Confirmation panel ───────────────────────────────────────────────────
  if (succeeded) {
    const totalStr = formatTotal(event.price_cents, event.currency, confirmedQty);
    return (
      <div
        className="animate-fade-up rounded-2xl border p-6 mt-4 shadow-sm"
        style={{
          borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        }}
        role="status"
        aria-live="polite"
      >
        <p
          className="font-heading text-lg font-bold mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          {isFree ? "Билеты подтверждены!" : "Билеты забронированы!"}
        </p>
        <p
          className="text-sm mb-1"
          style={{ color: "var(--color-primary)", opacity: 0.8 }}
        >
          {event.title} - билетов: {confirmedQty},{" "}
          итого: {totalStr}
        </p>
        {isFree ? (
          <p
            className="text-sm"
            style={{ color: "var(--color-primary)", opacity: 0.6 }}
          >
            Бесплатное событие - ваше место подтверждено.
          </p>
        ) : (
          <p
            className="text-sm"
            style={{ color: "var(--color-primary)", opacity: 0.6 }}
          >
            Забронировано - ожидается оплата. Бронь действует 30 минут.
          </p>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="mt-4 inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Готово
        </button>
      </div>
    );
  }

  // ── Collapsed trigger button ─────────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2"
        style={{ backgroundColor: "var(--color-accent)" }}
      >
        Купить билеты
      </button>
    );
  }

  // ── Checkout form ────────────────────────────────────────────────────────
  return (
    <form
      action={handleSubmit}
      className="animate-fade-up mt-4 rounded-2xl border p-6 space-y-5 shadow-sm"
      style={{
        borderColor: "rgba(0,0,0,0.10)",
        backgroundColor: "color-mix(in srgb, var(--color-secondary) 60%, #fff)",
      }}
      noValidate
    >
      {/* Hidden fields */}
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="event_id" value={event.id} />

      {/* Error banner */}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          role="alert"
          aria-live="assertive"
          style={{
            borderColor: "rgba(220,38,38,0.4)",
            backgroundColor: "rgba(220,38,38,0.07)",
            color: "var(--color-primary)",
          }}
        >
          {error}
        </div>
      )}

      {/* Quantity */}
      <div>
        <label
          htmlFor={`qty-${event.id}`}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          Количество
        </label>
        <select
          id={`qty-${event.id}`}
          name="quantity"
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
          className="rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
            backgroundColor: "var(--color-secondary)",
          }}
        >
          {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        {/* Live total */}
        <p
          className="mt-1.5 text-sm font-medium"
          style={{ color: "var(--color-accent)" }}
        >
          Итого:{" "}
          {formatTotal(event.price_cents, event.currency, quantity)}
        </p>
      </div>

      {/* Buyer name */}
      <div>
        <label
          htmlFor={`name-${event.id}`}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          Имя и фамилия <span aria-hidden="true">*</span>
        </label>
        <input
          id={`name-${event.id}`}
          name="buyer_name"
          type="text"
          required
          autoComplete="name"
          maxLength={120}
          placeholder="Иван Иванов"
          className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
            backgroundColor: "var(--color-secondary)",
          }}
        />
      </div>

      {/* Buyer email (optional) */}
      <div>
        <label
          htmlFor={`email-${event.id}`}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          Email{" "}
          <span
            className="font-normal"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
          >
            (необязательно)
          </span>
        </label>
        <input
          id={`email-${event.id}`}
          name="buyer_email"
          type="email"
          autoComplete="email"
          maxLength={254}
          placeholder="ivan@example.com"
          className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
            backgroundColor: "var(--color-secondary)",
          }}
        />
      </div>

      {/* Buyer phone (optional) */}
      <div>
        <label
          htmlFor={`phone-${event.id}`}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          Телефон{" "}
          <span
            className="font-normal"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
          >
            (необязательно)
          </span>
        </label>
        <input
          id={`phone-${event.id}`}
          name="buyer_phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          placeholder="+7 900 000 00 00"
          className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
            backgroundColor: "var(--color-secondary)",
          }}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isPending
            ? "Обработка…"
            : isFree
            ? "Подтвердить бесплатные билеты"
            : "Забронировать билеты"}
        </button>
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className="rounded-full border px-5 py-3 text-sm font-medium transition hover:opacity-75 focus:outline-none focus:ring-2 disabled:opacity-50"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
          }}
        >
          Отмена
        </button>
      </div>

      <p
        className="text-xs"
        style={{ color: "var(--color-primary)", opacity: 0.4 }}
      >
        Время указано по UTC.
        {!isFree &&
          " Забронированные билеты удерживаются 30 минут до оплаты."}
      </p>
    </form>
  );
}
