"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createReservation } from "@/lib/reservation-actions";
import type { AvailabilitySlot } from "@/lib/reservation-queries";
import type { FloorPlanWithTables } from "@/lib/floor-queries";
import { FloorPlanPicker } from "@/app/t/[slug]/floor/table-picker";
import type { SelectedTable } from "@/app/t/[slug]/floor/table-picker";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BookingFormProps {
  tenantId: string;
  slots: AvailabilitySlot[];
  plans: FloorPlanWithTables[];
  /** The selected party size - passed as a hidden field and shown in confirmations. */
  defaultParty: number;
  /** Optional table id pre-selected (from the floor page CTA). */
  preselectedTableId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO UTC datetime as "HH:MM UTC" for display.
 * Availability times are UTC by design - we display the UTC offset explicitly
 * to avoid silently rendering a misleading local time.
 */
function formatSlotTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/**
 * Format a UTC date string as a short human-readable date (e.g. "ср, 12 июн.").
 */
function formatSlotDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleDateString("ru-RU", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Derive a floor plan with non-available tables marked as non-bookable,
 * so the FloorPlanPicker will render them as unavailable zones.
 *
 * We never mutate the original plan object - we return a new object with
 * a new tables array where each table is given a derived is_bookable flag.
 *
 * Tables that are:
 *   - already non-bookable in the DB  → remain non-bookable
 *   - bookable but NOT in the slot's availableTableIds → marked non-bookable
 *   - bookable AND in availableTableIds → remain bookable
 */
function derivePlanForSlot(
  plan: FloorPlanWithTables,
  availableTableIds: string[]
): FloorPlanWithTables {
  const availableSet = new Set(availableTableIds);
  return {
    ...plan,
    tables: plan.tables.map((t) => ({
      ...t,
      is_bookable: t.is_bookable && availableSet.has(t.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// Submit button - receives isPending as a prop (driven by useTransition)
// ---------------------------------------------------------------------------

function SubmitButton({ isPending }: { isPending: boolean }) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="w-full rounded-full px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ backgroundColor: "var(--color-accent)" }}
    >
      {isPending ? "Отправляем…" : "Отправить заявку"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// BookingForm - main client island
// ---------------------------------------------------------------------------

export function BookingForm({
  tenantId,
  slots,
  plans,
  defaultParty,
  preselectedTableId,
}: BookingFormProps) {
  // ── Async submission state ───────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── Slot selection ───────────────────────────────────────────────────────
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);

  const selectedSlot = slots.find((s) => s.slot === selectedSlotIso) ?? null;

  // ── Table selection ──────────────────────────────────────────────────────
  // When a preselectedTableId arrives from the floor page, we attempt to find
  // a matching slot that lists this table as available, else we fall back to
  // no pre-selection (to avoid confusion).
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(
    null
  );

  // Initialise table selection once, when preselectedTableId is given.
  // We also check it's in the selected slot's available set before trusting it.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || !preselectedTableId || plans.length === 0) return;
    initialised.current = true;

    // Find the table data across all plans.
    for (const plan of plans) {
      const t = plan.tables.find((tbl) => tbl.id === preselectedTableId);
      if (t) {
        setSelectedTable({
          id: t.id,
          label: t.label,
          capacity: t.capacity,
          zone: t.zone,
          floor_plan_id: t.floor_plan_id,
        });
        break;
      }
    }
  }, [preselectedTableId, plans]);

  const handleTableSelect = useCallback(
    (table: SelectedTable | null) => {
      setSelectedTable(table);
    },
    []
  );

  // Invalidate table selection when it's no longer available in the chosen slot.
  useEffect(() => {
    if (!selectedSlot || !selectedTable) return;
    if (!selectedSlot.availableTableIds.includes(selectedTable.id)) {
      setSelectedTable(null);
    }
  }, [selectedSlot, selectedTable]);

  // ── Derived plans filtered to the selected slot ──────────────────────────
  const filteredPlans =
    selectedSlot !== null
      ? plans.map((plan) =>
          derivePlanForSlot(plan, selectedSlot.availableTableIds)
        )
      : plans;

  // ── Confirmed details (captured at success time so reset doesn't lose them)
  const [confirmedSlot, setConfirmedSlot] = useState<AvailabilitySlot | null>(null);
  const [confirmedTable, setConfirmedTable] = useState<SelectedTable | null>(null);

  // ── Form submit handler ──────────────────────────────────────────────────
  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createReservation(null, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        // Capture the details before resetting slot/table state.
        setConfirmedSlot(selectedSlot);
        setConfirmedTable(selectedTable);
        setSucceeded(true);
      }
    });
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setSucceeded(false);
    setError(null);
    setSelectedSlotIso(null);
    setSelectedTable(null);
    setConfirmedSlot(null);
    setConfirmedTable(null);
  }, []);

  // ── Confirmation panel ────────────────────────────────────────────────────
  if (succeeded && confirmedSlot) {
    return (
      <div
        className="animate-fade-up rounded-2xl border p-8 text-center shadow-sm"
        style={{
          borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        }}
        role="status"
        aria-live="polite"
      >
        <div
          className="font-heading text-2xl font-bold mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Заявка отправлена!
        </div>
        <p
          className="text-base mb-1"
          style={{ color: "var(--color-primary)", opacity: 0.8 }}
        >
          {formatSlotDate(confirmedSlot.slot)} в{" "}
          {formatSlotTime(confirmedSlot.slot)} - {defaultParty} гостей
          {confirmedTable ? `, столик ${confirmedTable.label}` : ""}
        </p>
        <p
          className="text-sm mb-6"
          style={{ color: "var(--color-primary)", opacity: 0.55 }}
        >
          Мы свяжемся с вами для подтверждения брони.
        </p>
        <button
          type="button"
          onClick={handleReset}
          className="inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Новое бронирование
        </button>
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-8"
      noValidate
    >
      {/* Hidden fields */}
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input
        type="hidden"
        name="starts_at"
        value={selectedSlotIso ?? ""}
      />
      <input
        type="hidden"
        name="floor_table_id"
        value={selectedTable?.id ?? ""}
      />
      <input type="hidden" name="party_size" value={String(defaultParty)} />

      {/* ── Server error ──────────────────────────────────────────────── */}
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

      {/* ── Step 1: Slot selection ────────────────────────────────────── */}
      <fieldset>
        <legend
          className="font-heading text-lg font-semibold mb-4"
          style={{ color: "var(--color-primary)" }}
        >
          1. Выберите время
          <span
            className="ml-2 text-sm font-normal"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
          >
            (время по UTC)
          </span>
        </legend>

        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Доступное время"
        >
          {slots.map((slot) => {
            const isSelected = selectedSlotIso === slot.slot;
            const isDisabled = !slot.anyTableFree;
            return (
              <button
                key={slot.slot}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                onClick={() =>
                  !isDisabled &&
                  setSelectedSlotIso(isSelected ? null : slot.slot)
                }
                className="rounded-full border px-5 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                style={
                  isSelected
                    ? {
                        backgroundColor: "var(--color-accent)",
                        borderColor: "var(--color-accent)",
                        color: "#ffffff",
                      }
                    : {
                        backgroundColor: "transparent",
                        borderColor: "color-mix(in srgb, var(--color-accent) 45%, transparent)",
                        color: "var(--color-primary)",
                      }
                }
              >
                {formatSlotTime(slot.slot)}
              </button>
            );
          })}
        </div>

        {selectedSlotIso === null && (
          <p
            className="mt-3 text-xs"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
            aria-live="polite"
          >
            Выберите время выше, чтобы продолжить.
          </p>
        )}
      </fieldset>

      {/* ── Step 2: Table selection (optional) ───────────────────────── */}
      {plans.length > 0 && (
        <section aria-label="Выбор столика (необязательно)">
          <h2
            className="font-heading text-lg font-semibold mb-1"
            style={{ color: "var(--color-primary)" }}
          >
            2. Выберите столик{" "}
            <span
              className="text-sm font-normal"
              style={{ color: "var(--color-primary)", opacity: 0.5 }}
            >
              (необязательно)
            </span>
          </h2>
          {selectedSlot === null && (
            <p
              className="text-sm mb-4"
              style={{ color: "var(--color-primary)", opacity: 0.5 }}
            >
              Сначала выберите время, чтобы увидеть свободные столики.
            </p>
          )}
          {selectedSlot !== null && (
            <p
              className="text-sm mb-4"
              style={{ color: "var(--color-primary)", opacity: 0.6 }}
            >
              Подсвеченные столики свободны для выбранного времени. Серые зоны уже заняты.
            </p>
          )}

          {filteredPlans.map((plan, idx) => (
            <div
              key={plan.id}
              className={idx > 0 ? "mt-10" : undefined}
            >
              {filteredPlans.length > 1 && (
                <h3
                  className="font-heading text-base font-semibold mb-3"
                  style={{ color: "var(--color-primary)" }}
                >
                  {plan.name}
                </h3>
              )}
              <FloorPlanPicker
                plan={plan}
                selectedTableId={
                  selectedTable?.floor_plan_id === plan.id
                    ? selectedTable.id
                    : null
                }
                onSelect={handleTableSelect}
              />
            </div>
          ))}

          {selectedTable && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: "var(--color-accent)" }}
              aria-live="polite"
            >
              Выбран столик {selectedTable.label} (мест:{" "}
              {selectedTable.capacity})
            </p>
          )}
        </section>
      )}

      {/* ── Step 3: Guest details ─────────────────────────────────────── */}
      <section aria-label="Your details">
        <h2
          className="font-heading text-lg font-semibold mb-4"
          style={{ color: "var(--color-primary)" }}
        >
          {plans.length > 0 ? "3." : "2."} Ваши данные
        </h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="guest_name"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Имя и фамилия <span aria-hidden="true">*</span>
            </label>
            <input
              id="guest_name"
              name="guest_name"
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

          {/* Email */}
          <div>
            <label
              htmlFor="guest_email"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Email
            </label>
            <input
              id="guest_email"
              name="guest_email"
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

          {/* Phone */}
          <div>
            <label
              htmlFor="guest_phone"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Телефон
            </label>
            <input
              id="guest_phone"
              name="guest_phone"
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
            <p
              className="text-xs mt-1"
              style={{ color: "var(--color-primary)", opacity: 0.5 }}
            >
              Укажите email или телефон, чтобы мы могли подтвердить бронь.
            </p>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              Пожелания{" "}
              <span
                className="font-normal"
                style={{ color: "var(--color-primary)", opacity: 0.5 }}
              >
                (необязательно)
              </span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={1000}
              placeholder="Диета, повод, особые пожелания и т. п."
              className="block w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 resize-none"
              style={{
                borderColor: "rgba(0,0,0,0.18)",
                color: "var(--color-primary)",
                backgroundColor: "var(--color-secondary)",
              }}
            />
          </div>
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <div>
        {selectedSlotIso === null && (
          <p
            className="text-sm mb-3 text-center"
            style={{ color: "var(--color-primary)", opacity: 0.5 }}
          >
            Выберите время выше, чтобы завершить бронирование.
          </p>
        )}
        <SubmitButton isPending={isPending} />
        <p
          className="text-xs text-center mt-3"
          style={{ color: "var(--color-primary)", opacity: 0.4 }}
        >
          Время указано по UTC. Бронь остаётся в ожидании, пока ресторан её не подтвердит.
        </p>
      </div>
    </form>
  );
}
