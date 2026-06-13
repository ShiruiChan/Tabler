"use client";

import { useState, useCallback, useId } from "react";
import type { FloorTable, TableZone } from "@/lib/types/database";
import type { FloorPlanWithTables } from "@/lib/floor-queries";

// ---------------------------------------------------------------------------
// Selection contract
// ---------------------------------------------------------------------------

/**
 * The value exposed by the picker's onSelect callback and selection state.
 * Phase 5 (TASK-018+) should pass onSelect to wire the picker into the
 * reservation flow - the picker is fully uncontrolled when onSelect is omitted.
 */
export interface SelectedTable {
  id: string;
  label: string;
  capacity: number;
  zone: TableZone;
  floor_plan_id: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FloorPlanPickerProps {
  /**
   * Serializable plan-with-tables object from the server.
   * Must not contain non-JSON-serialisable values (Date, etc.).
   */
  plan: FloorPlanWithTables;

  /**
   * Optional controlled/external selection handler.
   * When provided the caller can lift selection state out of this component.
   * When omitted the component manages its own selection (uncontrolled).
   */
  onSelect?: (table: SelectedTable | null) => void;

  /**
   * Optional externally-controlled selected table id.
   * Provide together with onSelect for a fully controlled picker.
   * When omitted the picker manages its own selection state.
   */
  selectedTableId?: string | null;

  /**
   * Optional base href for the "Book this table" CTA.
   * When provided, the disabled placeholder button is replaced with a real
   * anchor link: `${reserveHref}?table={selectedTableId}`.
   * Example: "./reserve" (relative, preserves the subdomain illusion).
   *
   * When omitted the picker falls back to the placeholder (disabled) button.
   */
  reserveHref?: string;
}

// ---------------------------------------------------------------------------
// Hatch pattern (non-bookable tables)
// ---------------------------------------------------------------------------

function HatchPattern({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        patternUnits="userSpaceOnUse"
        width={8}
        height={8}
        patternTransform="rotate(45)"
      >
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={8}
          stroke="var(--color-primary)"
          strokeOpacity={0.18}
          strokeWidth={3}
        />
      </pattern>
    </defs>
  );
}

// ---------------------------------------------------------------------------
// TableShape - single interactive or static shape
// ---------------------------------------------------------------------------

interface TableShapeProps {
  table: FloorTable;
  isSelected: boolean;
  isFocused: boolean;
  hatchId: string;
  onActivate: (table: FloorTable) => void;
  onFocus: (id: string) => void;
  onBlur: () => void;
}

function TableShape({ table, isSelected, isFocused, hatchId, onActivate, onFocus, onBlur }: TableShapeProps) {
  const zone = table.zone;
  const bookable = table.is_bookable;

  // ---- visual tokens (all via CSS variables to respect the theme) ----------
  // Bookable: fill uses accent on selected, transparent otherwise.
  // Non-bookable: rendered with a hatch pattern + low opacity, never interactive.
  const sharedShapeStyle: React.CSSProperties = bookable
    ? {
        fill: isSelected ? "var(--color-accent)" : "transparent",
        stroke: "var(--color-accent)",
        strokeWidth: isSelected ? 3 : 2,
        fillOpacity: isSelected ? 0.85 : 0,
        cursor: "pointer",
        outline: "none",
      }
    : {
        fill: `url(#${hatchId})`,
        stroke: "var(--color-primary)",
        strokeWidth: 1,
        fillOpacity: 1,
        strokeOpacity: 0.25,
        cursor: "default",
      };

  // Focus ring style rendered as a separate overlaid shape so it is always
  // visible regardless of selected/unselected state and background (photo or grid).
  const focusRingStyle: React.CSSProperties = {
    fill: "none",
    stroke: "var(--color-accent)",
    strokeWidth: 4,
    strokeDasharray: "6 3",
    strokeLinejoin: "round" as const,
    opacity: 0.9,
    // A white outer halo doubles the contrast over any background colour.
    filter: "drop-shadow(0 0 2px #fff)",
    pointerEvents: "none",
  };

  // Text halo: SVG presentation attributes applied directly to <text> so the
  // stroke is painted below the fill (paintOrder), keeping labels legible over
  // any background - photo, grid, selected fill, or hatch pattern.
  // These are SVG attributes, not CSS, so they are set as JSX props below.
  const textFill = bookable
    ? (isSelected ? "#ffffff" : "var(--color-accent)")
    : "var(--color-primary)";
  const textHaloStroke = bookable
    ? (isSelected ? "var(--color-accent)" : "#ffffff")
    : "#ffffff";
  const textStyle: React.CSSProperties = bookable
    ? { fontWeight: 600, pointerEvents: "none" }
    : { opacity: 0.35, fontWeight: 500, pointerEvents: "none" };

  const handleClick = bookable ? () => onActivate(table) : undefined;
  const handleKeyDown = bookable
    ? (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(table);
        }
      }
    : undefined;

  // Shared accessible props for bookable shapes
  const a11yProps = bookable
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-pressed": isSelected,
        "aria-label": `Столик ${table.label}, мест: ${table.capacity}`,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        onFocus: () => onFocus(table.id),
        onBlur: onBlur,
      }
    : {
        "aria-hidden": true as const,
      };

  if (zone.type === "rect") {
    const fontSize = Math.max(10, Math.min(zone.w, zone.h) * 0.28);
    return (
      <g>
        <rect
          x={zone.x}
          y={zone.y}
          width={zone.w}
          height={zone.h}
          rx={4}
          style={sharedShapeStyle}
          {...a11yProps}
        />
        {/* Keyboard focus ring - rendered only when this shape has focus */}
        {isFocused && (
          <rect
            x={zone.x - 3}
            y={zone.y - 3}
            width={zone.w + 6}
            height={zone.h + 6}
            rx={7}
            style={focusRingStyle}
          />
        )}
        <text
          x={zone.x + zone.w / 2}
          y={zone.y + zone.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fill={textFill}
          stroke={textHaloStroke}
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={textStyle}
        >
          {table.label}
        </text>
      </g>
    );
  }

  // circle
  const fontSize = Math.max(10, zone.r * 0.55);
  return (
    <g>
      <circle
        cx={zone.cx}
        cy={zone.cy}
        r={zone.r}
        style={sharedShapeStyle}
        {...a11yProps}
      />
      {/* Keyboard focus ring - rendered only when this shape has focus */}
      {isFocused && (
        <circle
          cx={zone.cx}
          cy={zone.cy}
          r={zone.r + 4}
          style={focusRingStyle}
        />
      )}
      <text
        x={zone.cx}
        y={zone.cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={textFill}
        stroke={textHaloStroke}
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={textStyle}
      >
        {table.label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// FloorPlanPicker - main export
// ---------------------------------------------------------------------------

export function FloorPlanPicker({
  plan,
  onSelect,
  selectedTableId: controlledSelectedId,
  reserveHref,
}: FloorPlanPickerProps) {
  // Internal selection state (used when the component is uncontrolled).
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  // Keyboard focus tracking - used to render a visible focus ring on shapes.
  const [focusedTableId, setFocusedTableId] = useState<string | null>(null);

  // Derive the effective selected id.
  const isControlled = controlledSelectedId !== undefined;
  const selectedId = isControlled ? (controlledSelectedId ?? null) : internalSelectedId;

  // Stable id for the SVG hatch pattern (avoids conflicts when multiple pickers render).
  const uid = useId();
  const hatchId = `hatch-${uid.replace(/:/g, "")}`;

  const handleActivate = useCallback(
    (table: FloorTable) => {
      const isCurrentlySelected = selectedId === table.id;
      const nextId = isCurrentlySelected ? null : table.id;

      if (!isControlled) {
        setInternalSelectedId(nextId);
      }

      if (onSelect) {
        if (nextId === null) {
          onSelect(null);
        } else {
          onSelect({
            id: table.id,
            label: table.label,
            capacity: table.capacity,
            zone: table.zone,
            floor_plan_id: table.floor_plan_id,
          });
        }
      }
    },
    [selectedId, isControlled, onSelect]
  );

  const selectedTable = plan.tables.find((t) => t.id === selectedId) ?? null;

  const bookableCount = plan.tables.filter((t) => t.is_bookable).length;

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-5 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border-2"
            style={{ borderColor: "var(--color-accent)" }}
            aria-hidden="true"
          />
          <span style={{ color: "var(--color-primary)", opacity: 0.75 }}>
            Свободно
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{
              background: "repeating-linear-gradient(45deg, rgba(0,0,0,0.12) 0, rgba(0,0,0,0.12) 1px, transparent 0, transparent 50%)",
              backgroundSize: "4px 4px",
              border: "1px solid rgba(0,0,0,0.15)",
            }}
            aria-hidden="true"
          />
          <span style={{ color: "var(--color-primary)", opacity: 0.55 }}>
            Недоступно
          </span>
        </span>
        {bookableCount > 0 && (
          <span
            className="ml-auto text-xs"
            style={{ color: "var(--color-primary)", opacity: 0.55 }}
          >
            Свободно столиков: {bookableCount}
          </span>
        )}
      </div>

      {/* SVG canvas */}
      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: "rgba(0,0,0,0.10)" }}
        role="region"
        aria-label={`План зала: ${plan.name}`}
      >
        <svg
          viewBox={`0 0 ${plan.width} ${plan.height}`}
          style={{
            width: "100%",
            maxWidth: plan.width,
            aspectRatio: `${plan.width} / ${plan.height}`,
            display: "block",
            userSelect: "none",
          }}
          aria-label={`Интерактивная карта зала: ${plan.name}`}
        >
          <HatchPattern id={hatchId} />

          {/* Background: image or grid fallback */}
          {plan.image_url ? (
            <image
              href={plan.image_url}
              x={0}
              y={0}
              width={plan.width}
              height={plan.height}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <>
              <defs>
                <pattern
                  id={`grid-${uid.replace(/:/g, "")}`}
                  width={50}
                  height={50}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 50 0 L 0 0 0 50"
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeOpacity={0.08}
                    strokeWidth={1}
                  />
                </pattern>
              </defs>
              <rect
                width={plan.width}
                height={plan.height}
                fill="var(--color-secondary)"
              />
              <rect
                width={plan.width}
                height={plan.height}
                fill={`url(#grid-${uid.replace(/:/g, "")})`}
              />
            </>
          )}

          {/* Tables */}
          {plan.tables.map((table) => (
            <TableShape
              key={table.id}
              table={table}
              isSelected={table.id === selectedId}
              isFocused={table.id === focusedTableId}
              hatchId={hatchId}
              onActivate={handleActivate}
              onFocus={setFocusedTableId}
              onBlur={() => setFocusedTableId(null)}
            />
          ))}
        </svg>
      </div>

      {/* Selection summary panel */}
      {selectedTable ? (
        <div
          className="animate-fade-up rounded-xl px-5 py-4 border shadow-sm"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
            borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
          }}
          role="status"
          aria-live="polite"
          aria-label="Сведения о выбранном столике"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p
                className="text-base font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                Столик {selectedTable.label}
              </p>
              <p
                className="text-sm mt-0.5"
                style={{ color: "var(--color-primary)", opacity: 0.65 }}
              >
                Мест: {selectedTable.capacity}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {reserveHref ? (
                /* Live booking CTA - links to the reserve page with this table pre-selected */
                <a
                  href={`${reserveHref}?table=${selectedTable.id}`}
                  className="inline-flex items-center rounded-full px-5 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "#ffffff",
                  }}
                >
                  Забронировать
                </a>
              ) : (
                /* Placeholder CTA when no booking route is configured */
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex items-center rounded-full px-5 py-2 text-sm font-semibold opacity-50 cursor-not-allowed"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "#ffffff",
                  }}
                  title="Онлайн-бронирование скоро будет доступно"
                >
                  Забронировать
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center rounded-full border px-5 py-2 text-sm font-medium transition hover:opacity-70 focus:outline-none focus:ring-2"
                style={{
                  borderColor: "color-mix(in srgb, var(--color-primary) 25%, transparent)",
                  color: "var(--color-primary)",
                }}
                onClick={() => handleActivate(selectedTable)}
                aria-label="Сбросить выбор столика"
              >
                Сбросить
              </button>
            </div>
          </div>
          {!reserveHref && (
            <p
              className="text-xs mt-3 italic"
              style={{ color: "var(--color-primary)", opacity: 0.45 }}
            >
              Онлайн-бронирование скоро будет доступно. Позвоните нам, чтобы забронировать этот столик.
            </p>
          )}
        </div>
      ) : (
        bookableCount > 0 && (
          <p
            className="text-sm"
            style={{ color: "var(--color-primary)", opacity: 0.55 }}
            aria-live="polite"
          >
            Выберите столик на карте, чтобы увидеть детали.
          </p>
        )
      )}
    </div>
  );
}
