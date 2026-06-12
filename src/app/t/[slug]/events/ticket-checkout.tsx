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
  if (cents === 0) return "Free";
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
// TicketCheckout — client island per event
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
        className="inline-block rounded-lg px-4 py-2 text-sm font-semibold cursor-not-allowed opacity-50"
        style={{
          border: "1px solid var(--color-accent)",
          color: "var(--color-accent)",
        }}
        aria-disabled="true"
      >
        Sold out
      </span>
    );
  }

  // ── Confirmation panel ───────────────────────────────────────────────────
  if (succeeded) {
    const totalStr = formatTotal(event.price_cents, event.currency, confirmedQty);
    return (
      <div
        className="rounded-xl border p-6 mt-4"
        style={{
          borderColor: "var(--color-accent)",
          backgroundColor: "rgba(0,0,0,0.03)",
        }}
        role="status"
        aria-live="polite"
      >
        <p
          className="font-heading text-lg font-bold mb-1"
          style={{ color: "var(--color-primary)" }}
        >
          {isFree ? "Tickets confirmed!" : "Tickets reserved!"}
        </p>
        <p
          className="text-sm mb-1"
          style={{ color: "var(--color-primary)", opacity: 0.8 }}
        >
          {event.title} — {confirmedQty} ticket{confirmedQty !== 1 ? "s" : ""},{" "}
          total: {totalStr}
        </p>
        {isFree ? (
          <p
            className="text-sm"
            style={{ color: "var(--color-primary)", opacity: 0.6 }}
          >
            Free event — your spot is confirmed.
          </p>
        ) : (
          <p
            className="text-sm"
            style={{ color: "var(--color-primary)", opacity: 0.6 }}
          >
            Reserved — payment due. Your hold expires in 30 minutes.
          </p>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="mt-4 inline-block rounded-lg px-5 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Done
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
        className="inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2"
        style={{ backgroundColor: "var(--color-accent)" }}
      >
        Get tickets
      </button>
    );
  }

  // ── Checkout form ────────────────────────────────────────────────────────
  return (
    <form
      action={handleSubmit}
      className="mt-4 rounded-xl border p-6 space-y-5"
      style={{
        borderColor: "rgba(0,0,0,0.10)",
        backgroundColor: "rgba(0,0,0,0.03)",
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
          Quantity
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
          Total:{" "}
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
          Full name <span aria-hidden="true">*</span>
        </label>
        <input
          id={`name-${event.id}`}
          name="buyer_name"
          type="text"
          required
          autoComplete="name"
          maxLength={120}
          placeholder="Jane Smith"
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
            (optional)
          </span>
        </label>
        <input
          id={`email-${event.id}`}
          name="buyer_email"
          type="email"
          autoComplete="email"
          maxLength={254}
          placeholder="jane@example.com"
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
          Phone{" "}
          <span
            className="font-normal"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
          >
            (optional)
          </span>
        </label>
        <input
          id={`phone-${event.id}`}
          name="buyer_phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          placeholder="+1 555 000 0000"
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
          className="flex-1 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isPending
            ? "Processing…"
            : isFree
            ? "Confirm free tickets"
            : "Reserve tickets"}
        </button>
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className="rounded-lg border px-5 py-2.5 text-sm font-medium transition hover:opacity-75 focus:outline-none focus:ring-2 disabled:opacity-50"
          style={{
            borderColor: "rgba(0,0,0,0.18)",
            color: "var(--color-primary)",
          }}
        >
          Cancel
        </button>
      </div>

      <p
        className="text-xs"
        style={{ color: "var(--color-primary)", opacity: 0.4 }}
      >
        All times shown in UTC.
        {!isFree &&
          " Reserved tickets are held for 30 minutes pending payment."}
      </p>
    </form>
  );
}
