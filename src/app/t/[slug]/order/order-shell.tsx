"use client";

/**
 * OrderShell — main client island for the B2C ordering flow.
 *
 * Responsibilities:
 *   - Client-side cart state (NO server cart).
 *   - Menu browsing with add/remove/quantity controls.
 *   - Order-type toggle: in_session (table select) | delivery (zone, address,
 *     fee messaging).
 *   - Customer fields (name req, email/phone opt).
 *   - Submit via direct await in startTransition (TASK-020 pattern, no
 *     useFormState).
 *   - Confirmation panel from the returned success snapshot.
 */

import { useState, useTransition } from "react";
import { placeOrder } from "@/lib/order-actions";
import type { PlaceOrderResult, OrderSuccess } from "@/lib/order-actions";
import type { MenuCategoryWithDishes } from "@/lib/menu-queries";
import type { FloorPlanWithTables } from "@/lib/floor-queries";
import type { OrderingContext } from "@/lib/order-queries";
import type { Dish } from "@/lib/types/database";

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

// ---------------------------------------------------------------------------
// Cart state
// ---------------------------------------------------------------------------

type CartLine = {
  dish: Dish;
  quantity: number;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface OrderShellProps {
  tenantId: string;
  menu: MenuCategoryWithDishes[];
  floorPlans: FloorPlanWithTables[];
  orderingContext: OrderingContext;
  deliveryEnabled: boolean;
}

// ---------------------------------------------------------------------------
// OrderShell
// ---------------------------------------------------------------------------

export function OrderShell({
  tenantId,
  menu,
  floorPlans,
  orderingContext,
  deliveryEnabled,
}: OrderShellProps) {
  const { settings, zones, deliveryOpenNow } = orderingContext;
  const currency = settings?.currency ?? "usd";

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());

  function addToCart(dish: Dish) {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(dish.id);
      if (existing) {
        next.set(dish.id, { dish, quantity: Math.min(100, existing.quantity + 1) });
      } else {
        next.set(dish.id, { dish, quantity: 1 });
      }
      return next;
    });
  }

  function decrementCart(dish: Dish) {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(dish.id);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        next.delete(dish.id);
      } else {
        next.set(dish.id, { dish, quantity: existing.quantity - 1 });
      }
      return next;
    });
  }

  function removeFromCart(dishId: string) {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(dishId);
      return next;
    });
  }

  const cartLines = Array.from(cart.values());
  const subtotal = cartLines.reduce(
    (acc, l) => acc + l.dish.price_cents * l.quantity,
    0
  );

  // ── Order type ────────────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<"in_session" | "delivery">(
    "in_session"
  );

  // ── Table selection (in_session) ──────────────────────────────────────────
  const allTables = floorPlans.flatMap((plan) =>
    plan.tables.filter((t) => t.is_bookable)
  );
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  // ── Delivery fields ───────────────────────────────────────────────────────
  const [selectedZoneId, setSelectedZoneId] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");

  // Resolved delivery fee (live computation for UI display).
  const resolvedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const baseFee =
    resolvedZone?.fee_override_cents != null
      ? resolvedZone.fee_override_cents
      : (settings?.base_fee_cents ?? 0);
  const freeOver = settings?.free_delivery_over_cents ?? null;
  const deliveryFee =
    freeOver != null && subtotal >= freeOver ? 0 : baseFee;
  const displayTotal =
    orderType === "delivery" ? subtotal + deliveryFee : subtotal;

  const minOrder =
    resolvedZone?.min_order_override_cents != null
      ? resolvedZone.min_order_override_cents
      : (settings?.min_order_cents ?? 0);

  const belowMinimum =
    orderType === "delivery" && minOrder > 0 && subtotal < minOrder;

  // ── Customer fields ───────────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // ── Submission state ──────────────────────────────────────────────────────
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<OrderSuccess | null>(null);

  // ── Reset after confirmation ──────────────────────────────────────────────
  function handleNewOrder() {
    setConfirmation(null);
    setError(null);
    setCart(new Map());
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
    setNotes("");
    setSelectedTableId("");
    setSelectedZoneId("");
    setDeliveryAddress("");
    setOrderType("in_session");
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const items = cartLines.map((l) => ({
      dish_id: l.dish.id,
      quantity: l.quantity,
    }));

    const formData = new FormData();
    formData.set("tenant_id", tenantId);
    formData.set("order_type", orderType);
    formData.set("customer_name", customerName);
    formData.set("customer_email", customerEmail);
    formData.set("customer_phone", customerPhone);
    formData.set("notes", notes);
    formData.set("items", JSON.stringify(items));

    if (orderType === "in_session") {
      formData.set("table_id", selectedTableId);
    } else {
      formData.set("delivery_zone_id", selectedZoneId);
      formData.set("delivery_address", deliveryAddress);
    }

    startTransition(async () => {
      const result: PlaceOrderResult = await placeOrder(null, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setConfirmation(result.success);
      }
    });
  }

  // ── Confirmation panel ────────────────────────────────────────────────────
  if (confirmation) {
    const shortId = confirmation.order_id.slice(0, 8).toUpperCase();
    return (
      <div
        className="rounded-xl border p-8"
        style={{
          borderColor: "var(--color-accent)",
          backgroundColor: "rgba(0,0,0,0.03)",
        }}
        role="status"
        aria-live="polite"
      >
        <h2
          className="font-heading text-xl font-bold mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Order placed!
        </h2>
        <p
          className="text-sm mb-1"
          style={{ color: "var(--color-primary)", opacity: 0.8 }}
        >
          Reference: <strong>#{shortId}</strong>
        </p>
        <p
          className="text-sm mb-1"
          style={{ color: "var(--color-primary)", opacity: 0.8 }}
        >
          Total:{" "}
          <strong>
            {formatCents(confirmation.total_cents, confirmation.currency)}
          </strong>
        </p>
        {confirmation.estimated_minutes != null && (
          <p
            className="text-sm mb-4"
            style={{ color: "var(--color-primary)", opacity: 0.8 }}
          >
            Estimated delivery: ~{confirmation.estimated_minutes} min
          </p>
        )}
        <p
          className="text-sm mb-6"
          style={{ color: "var(--color-primary)", opacity: 0.6 }}
        >
          Your order is pending confirmation from the restaurant.
          {orderType === "delivery" &&
            " All times are shown in UTC."}
        </p>
        <button
          type="button"
          onClick={handleNewOrder}
          className="inline-block rounded-lg px-5 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Place another order
        </button>
      </div>
    );
  }

  // ── Empty menu ────────────────────────────────────────────────────────────
  if (menu.length === 0) {
    return (
      <p
        className="text-base"
        style={{ color: "var(--color-primary)", opacity: 0.7 }}
      >
        Our menu is coming soon. Check back later!
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {/* ── Menu & Cart ─────────────────────────────────────────────────── */}
      <section aria-label="Menu">
        {menu.map((category) => (
          <div key={category.id} className="mb-10">
            <h2
              className="font-heading text-lg font-semibold mb-3 border-b pb-2"
              style={{
                color: "var(--color-primary)",
                borderColor: "rgba(0,0,0,0.10)",
              }}
            >
              {category.name}
            </h2>
            {category.description && (
              <p
                className="text-sm mb-3"
                style={{ color: "var(--color-primary)", opacity: 0.65 }}
              >
                {category.description}
              </p>
            )}
            <ul className="space-y-3">
              {category.dishes.map((dish) => {
                const line = cart.get(dish.id);
                const qty = line?.quantity ?? 0;
                return (
                  <li
                    key={dish.id}
                    className="flex items-center gap-4 rounded-lg p-3"
                    style={{ backgroundColor: "rgba(0,0,0,0.04)" }}
                  >
                    {dish.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={dish.photo_url}
                        alt={dish.name}
                        className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-heading text-sm font-semibold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        {dish.name}
                      </p>
                      {dish.description && (
                        <p
                          className="text-xs mt-0.5 line-clamp-2"
                          style={{ color: "var(--color-primary)", opacity: 0.65 }}
                        >
                          {dish.description}
                        </p>
                      )}
                      <p
                        className="text-sm font-medium mt-1"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {formatCents(dish.price_cents, currency)}
                      </p>
                    </div>
                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {qty > 0 ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Remove one ${dish.name}`}
                            onClick={() => decrementCart(dish)}
                            className="w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center border transition hover:opacity-75 focus:outline-none focus:ring-2"
                            style={{
                              borderColor: "var(--color-accent)",
                              color: "var(--color-accent)",
                            }}
                          >
                            −
                          </button>
                          <span
                            className="w-5 text-center text-sm font-semibold"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {qty}
                          </span>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Add ${dish.name}`}
                        onClick={() => addToCart(dish)}
                        disabled={qty >= 100}
                        className="w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      >
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {/* ── Cart summary ────────────────────────────────────────────────── */}
      {cartLines.length > 0 && (
        <section
          aria-label="Cart summary"
          className="rounded-xl border p-5"
          style={{
            borderColor: "rgba(0,0,0,0.10)",
            backgroundColor: "rgba(0,0,0,0.03)",
          }}
        >
          <h2
            className="font-heading text-base font-semibold mb-3"
            style={{ color: "var(--color-primary)" }}
          >
            Cart
          </h2>
          <ul className="space-y-2 mb-3">
            {cartLines.map((line) => (
              <li
                key={line.dish.id}
                className="flex items-center justify-between text-sm"
              >
                <span style={{ color: "var(--color-primary)" }}>
                  {line.dish.name}{" "}
                  <span style={{ opacity: 0.6 }}>× {line.quantity}</span>
                </span>
                <div className="flex items-center gap-3">
                  <span
                    style={{ color: "var(--color-primary)", opacity: 0.8 }}
                  >
                    {formatCents(line.dish.price_cents * line.quantity, currency)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.dish.name}`}
                    onClick={() => removeFromCart(line.dish.id)}
                    className="text-xs underline transition hover:opacity-70 focus:outline-none"
                    style={{ color: "rgb(220,38,38)" }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t pt-2" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
            <div className="flex justify-between text-sm font-medium">
              <span style={{ color: "var(--color-primary)", opacity: 0.7 }}>
                Subtotal
              </span>
              <span style={{ color: "var(--color-primary)" }}>
                {formatCents(subtotal, currency)}
              </span>
            </div>
            {orderType === "delivery" && (
              <>
                <div className="flex justify-between text-sm mt-1">
                  <span style={{ color: "var(--color-primary)", opacity: 0.7 }}>
                    Delivery fee
                  </span>
                  <span
                    style={{
                      color: deliveryFee === 0 ? "rgb(22,163,74)" : "var(--color-primary)",
                    }}
                  >
                    {deliveryFee === 0
                      ? "Free"
                      : formatCents(deliveryFee, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold mt-1">
                  <span style={{ color: "var(--color-primary)" }}>Total</span>
                  <span style={{ color: "var(--color-accent)" }}>
                    {formatCents(displayTotal, currency)}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Checkout form ───────────────────────────────────────────────── */}
      {cartLines.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
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

          {/* Order type toggle */}
          <div>
            <p
              className="text-sm font-medium mb-2"
              style={{ color: "var(--color-primary)" }}
            >
              Order type
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderType("in_session")}
                className="rounded-lg px-4 py-2 text-sm font-medium border transition focus:outline-none focus:ring-2"
                style={{
                  backgroundColor:
                    orderType === "in_session"
                      ? "var(--color-accent)"
                      : "transparent",
                  color:
                    orderType === "in_session"
                      ? "#fff"
                      : "var(--color-primary)",
                  borderColor:
                    orderType === "in_session"
                      ? "var(--color-accent)"
                      : "rgba(0,0,0,0.18)",
                }}
              >
                Dine-in
              </button>
              {deliveryEnabled && (
                <button
                  type="button"
                  onClick={() => setOrderType("delivery")}
                  className="rounded-lg px-4 py-2 text-sm font-medium border transition focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor:
                      orderType === "delivery"
                        ? "var(--color-accent)"
                        : "transparent",
                    color:
                      orderType === "delivery"
                        ? "#fff"
                        : "var(--color-primary)",
                    borderColor:
                      orderType === "delivery"
                        ? "var(--color-accent)"
                        : "rgba(0,0,0,0.18)",
                  }}
                >
                  Delivery
                </button>
              )}
            </div>
          </div>

          {/* ── In-session: table picker ──────────────────────────────── */}
          {orderType === "in_session" && (
            <div>
              <label
                htmlFor="table-select"
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-primary)" }}
              >
                Table <span aria-hidden="true">*</span>
              </label>
              {allTables.length === 0 ? (
                <p
                  className="text-sm"
                  style={{ color: "var(--color-primary)", opacity: 0.6 }}
                >
                  No tables are currently available for ordering.
                </p>
              ) : (
                <select
                  id="table-select"
                  value={selectedTableId}
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  required
                  className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{
                    borderColor: "rgba(0,0,0,0.18)",
                    color: "var(--color-primary)",
                    backgroundColor: "var(--color-secondary)",
                  }}
                >
                  <option value="">Select a table…</option>
                  {floorPlans.map((plan) => (
                    <optgroup key={plan.id} label={plan.name}>
                      {plan.tables
                        .filter((t) => t.is_bookable)
                        .map((table) => (
                          <option key={table.id} value={table.id}>
                            Table {table.label} (seats {table.capacity})
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* ── Delivery fields ───────────────────────────────────────── */}
          {orderType === "delivery" && (
            <div className="space-y-4">
              {/* Delivery closed notice */}
              {!deliveryOpenNow && (
                <div
                  className="rounded-lg border px-4 py-3 text-sm"
                  role="status"
                  style={{
                    borderColor: "rgba(202,138,4,0.5)",
                    backgroundColor: "rgba(202,138,4,0.08)",
                    color: "var(--color-primary)",
                  }}
                >
                  Delivery is currently closed. Orders placed outside delivery
                  hours will be rejected. All schedule times are in UTC.
                </div>
              )}

              {/* Delivery not enabled notice */}
              {!settings?.is_enabled && (
                <div
                  className="rounded-lg border px-4 py-3 text-sm"
                  role="status"
                  style={{
                    borderColor: "rgba(220,38,38,0.4)",
                    backgroundColor: "rgba(220,38,38,0.07)",
                    color: "var(--color-primary)",
                  }}
                >
                  Delivery is not currently available at this restaurant.
                </div>
              )}

              {/* Zone select (only when zones exist) */}
              {zones.length > 0 && (
                <div>
                  <label
                    htmlFor="zone-select"
                    className="block text-sm font-medium mb-1"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Delivery zone <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="zone-select"
                    value={selectedZoneId}
                    onChange={(e) => setSelectedZoneId(e.target.value)}
                    required
                    className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{
                      borderColor: "rgba(0,0,0,0.18)",
                      color: "var(--color-primary)",
                      backgroundColor: "var(--color-secondary)",
                    }}
                  >
                    <option value="">Select a zone…</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                        {zone.fee_override_cents != null
                          ? ` — ${formatCents(zone.fee_override_cents, currency)} delivery`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fee / free-delivery messaging */}
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{
                  backgroundColor: "rgba(0,0,0,0.04)",
                  color: "var(--color-primary)",
                  opacity: 0.8,
                }}
              >
                {freeOver != null && subtotal >= freeOver ? (
                  <span style={{ color: "rgb(22,163,74)", fontWeight: 600 }}>
                    Free delivery applied (subtotal ≥{" "}
                    {formatCents(freeOver, currency)})
                  </span>
                ) : (
                  <>
                    Delivery fee:{" "}
                    <strong>{formatCents(baseFee, currency)}</strong>
                    {freeOver != null && (
                      <>
                        {" "}· Free delivery over{" "}
                        <strong>{formatCents(freeOver, currency)}</strong>
                        {" ("}
                        {formatCents(freeOver - subtotal, currency)} more needed
                        {")"}
                      </>
                    )}
                  </>
                )}
                {belowMinimum && (
                  <p className="mt-1" style={{ color: "rgb(220,38,38)" }}>
                    Minimum order:{" "}
                    {formatCents(minOrder, currency)} (
                    {formatCents(minOrder - subtotal, currency)} more needed)
                  </p>
                )}
                {settings?.estimated_minutes != null && (
                  <p className="mt-1">
                    Estimated delivery: ~{settings.estimated_minutes} min
                  </p>
                )}
              </div>

              {/* Delivery address */}
              <div>
                <label
                  htmlFor="delivery-address"
                  className="block text-sm font-medium mb-1"
                  style={{ color: "var(--color-primary)" }}
                >
                  Delivery address <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="delivery-address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  required
                  maxLength={500}
                  rows={2}
                  placeholder="123 Main St, Apt 4B, City"
                  className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 resize-y"
                  style={{
                    borderColor: "rgba(0,0,0,0.18)",
                    color: "var(--color-primary)",
                    backgroundColor: "var(--color-secondary)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Customer name */}
          <div>
            <label
              htmlFor="customer-name"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Your name <span aria-hidden="true">*</span>
            </label>
            <input
              id="customer-name"
              type="text"
              required
              autoComplete="name"
              maxLength={120}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Jane Smith"
              className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{
                borderColor: "rgba(0,0,0,0.18)",
                color: "var(--color-primary)",
                backgroundColor: "var(--color-secondary)",
              }}
            />
          </div>

          {/* Customer email (optional) */}
          <div>
            <label
              htmlFor="customer-email"
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
              id="customer-email"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="jane@example.com"
              className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{
                borderColor: "rgba(0,0,0,0.18)",
                color: "var(--color-primary)",
                backgroundColor: "var(--color-secondary)",
              }}
            />
          </div>

          {/* Customer phone (optional) */}
          <div>
            <label
              htmlFor="customer-phone"
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
              id="customer-phone"
              type="tel"
              autoComplete="tel"
              minLength={5}
              maxLength={40}
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{
                borderColor: "rgba(0,0,0,0.18)",
                color: "var(--color-primary)",
                backgroundColor: "var(--color-secondary)",
              }}
            />
          </div>

          {/* Notes (optional) */}
          <div>
            <label
              htmlFor="order-notes"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Special requests{" "}
              <span
                className="font-normal"
                style={{ color: "var(--color-primary)", opacity: 0.5 }}
              >
                (optional)
              </span>
            </label>
            <textarea
              id="order-notes"
              maxLength={2000}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergies, dietary requirements…"
              className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 resize-y"
              style={{
                borderColor: "rgba(0,0,0,0.18)",
                color: "var(--color-primary)",
                backgroundColor: "var(--color-secondary)",
              }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={
              isPending ||
              cartLines.length === 0 ||
              belowMinimum ||
              (orderType === "in_session" && !selectedTableId && allTables.length > 0) ||
              (orderType === "delivery" && zones.length > 0 && !selectedZoneId) ||
              (orderType === "delivery" && !deliveryAddress.trim()) ||
              !customerName.trim()
            }
            className="w-full rounded-lg px-6 py-3 text-sm font-semibold text-white shadow transition hover:opacity-90 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {isPending ? "Placing order…" : "Place order"}
          </button>

          <p
            className="text-xs"
            style={{ color: "var(--color-primary)", opacity: 0.4 }}
          >
            All delivery schedule times are in UTC. Orders are created as
            pending and confirmed by the restaurant.
          </p>
        </form>
      )}
    </div>
  );
}
