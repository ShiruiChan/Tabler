"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormState, useFormStatus } from "react-dom";
import { upsertTable, deleteTable } from "@/lib/floor-actions";
import type { FloorActionState } from "@/lib/floor-actions";
import type { FloorPlan, FloorTable, TableZone } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShapeMode = "rect" | "circle";

interface DragState {
  startX: number; // logical coords
  startY: number;
  currentX: number;
  currentY: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an SVG pointer event position to logical floor-plan coordinates. */
function svgToLogical(
  e: React.PointerEvent<SVGElement>,
  svg: SVGSVGElement,
  planWidth: number,
  planHeight: number
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const rawX = ((e.clientX - rect.left) / rect.width) * planWidth;
  const rawY = ((e.clientY - rect.top) / rect.height) * planHeight;
  return {
    x: Math.max(0, Math.min(planWidth, Math.round(rawX))),
    y: Math.max(0, Math.min(planHeight, Math.round(rawY))),
  };
}

/** Derive a TableZone from a drag operation. Returns null if zone is too small. */
function dragToZone(drag: DragState, mode: ShapeMode): TableZone | null {
  if (mode === "rect") {
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const w = Math.abs(drag.currentX - drag.startX);
    const h = Math.abs(drag.currentY - drag.startY);
    if (w < 10 || h < 10) return null;
    return { type: "rect", x, y, w, h };
  } else {
    const dx = drag.currentX - drag.startX;
    const dy = drag.currentY - drag.startY;
    const r = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (r < 5) return null;
    return { type: "circle", cx: drag.startX, cy: drag.startY, r };
  }
}

/** Render a TableZone preview (ghost) while dragging. */
function DragPreview({
  drag,
  mode,
}: {
  drag: DragState;
  mode: ShapeMode;
}) {
  if (mode === "rect") {
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const w = Math.abs(drag.currentX - drag.startX);
    const h = Math.abs(drag.currentY - drag.startY);
    if (w < 2 || h < 2) return null;
    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(59,130,246,0.2)"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="6 3"
        pointerEvents="none"
      />
    );
  } else {
    const dx = drag.currentX - drag.startX;
    const dy = drag.currentY - drag.startY;
    const r = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (r < 2) return null;
    return (
      <circle
        cx={drag.startX}
        cy={drag.startY}
        r={r}
        fill="rgba(59,130,246,0.2)"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="6 3"
        pointerEvents="none"
      />
    );
  }
}

// ---------------------------------------------------------------------------
// TableShape — renders a single table as an SVG shape
// ---------------------------------------------------------------------------

function TableShape({
  table,
  isSelected,
  onClick,
}: {
  table: FloorTable;
  isSelected: boolean;
  onClick: () => void;
}) {
  const zone = table.zone;
  const fillBookable = isSelected ? "#1e40af" : "#3b82f6";
  const fillNonBookable = isSelected ? "#4b5563" : "#9ca3af";
  const fill = table.is_bookable ? fillBookable : fillNonBookable;
  const stroke = isSelected ? "#1e3a8a" : "transparent";
  const textFill = "#ffffff";
  const opacity = table.is_bookable ? 0.85 : 0.55;

  const sharedProps = {
    fill,
    fillOpacity: opacity,
    stroke,
    strokeWidth: isSelected ? 3 : 0,
    style: { cursor: "pointer" } as React.CSSProperties,
    onClick,
    role: "button" as const,
    "aria-label": `Table ${table.label}`,
  };

  if (zone.type === "rect") {
    return (
      <g>
        <rect
          x={zone.x}
          y={zone.y}
          width={zone.w}
          height={zone.h}
          rx={4}
          {...sharedProps}
        />
        <text
          x={zone.x + zone.w / 2}
          y={zone.y + zone.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.min(zone.w, zone.h) * 0.35}
          fill={textFill}
          pointerEvents="none"
          fontWeight="600"
        >
          {table.label}
        </text>
      </g>
    );
  } else {
    return (
      <g>
        <circle
          cx={zone.cx}
          cy={zone.cy}
          r={zone.r}
          {...sharedProps}
        />
        <text
          x={zone.cx}
          y={zone.cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={zone.r * 0.6}
          fill={textFill}
          pointerEvents="none"
          fontWeight="600"
        >
          {table.label}
        </text>
      </g>
    );
  }
}

// ---------------------------------------------------------------------------
// TableForm — create/edit panel that slides in below the canvas
// ---------------------------------------------------------------------------

function UpsertSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save table"}
    </button>
  );
}

interface TableFormProps {
  planId: string;
  planWidth: number;
  planHeight: number;
  /** When null: creating a new table using the drawn zone. */
  editingTable: FloorTable | null;
  /** The zone drawn on the canvas (used only when editingTable is null). */
  drawnZone: TableZone | null;
  onClose: () => void;
}

const upsertInitialState: FloorActionState = null;

function TableForm({
  planId,
  planWidth,
  planHeight,
  editingTable,
  drawnZone,
  onClose,
}: TableFormProps) {
  const [state, formAction] = useFormState(upsertTable, upsertInitialState);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  // The live zone: starts from the editing table's zone (if any) or the drawn zone.
  const initialZone: TableZone | null = editingTable?.zone ?? drawnZone ?? null;

  const [zoneType, setZoneType] = useState<"rect" | "circle">(
    initialZone?.type ?? "rect"
  );

  // Rect fields
  const [rx, setRx] = useState(
    initialZone?.type === "rect" ? initialZone.x : 0
  );
  const [ry, setRy] = useState(
    initialZone?.type === "rect" ? initialZone.y : 0
  );
  const [rw, setRw] = useState(
    initialZone?.type === "rect" ? initialZone.w : 100
  );
  const [rh, setRh] = useState(
    initialZone?.type === "rect" ? initialZone.h : 80
  );

  // Circle fields
  const [cx, setCx] = useState(
    initialZone?.type === "circle" ? initialZone.cx : 100
  );
  const [cy, setCy] = useState(
    initialZone?.type === "circle" ? initialZone.cy : 100
  );
  const [cr, setCr] = useState(
    initialZone?.type === "circle" ? initialZone.r : 50
  );

  // Build the zone JSON string for the hidden input.
  const zoneJson =
    zoneType === "rect"
      ? JSON.stringify({ type: "rect", x: rx, y: ry, w: rw, h: rh })
      : JSON.stringify({ type: "circle", cx, cy, r: cr });

  // Close on successful save (state becomes null after success, then rerender
  // from server replaces this component anyway — just handle the error case).
  const prevState = useRef(state);
  useEffect(() => {
    if (prevState.current !== null && state === null) {
      onClose();
    }
    prevState.current = state;
  }, [state, onClose]);

  function handleDelete() {
    if (!editingTable) return;
    if (
      !confirm(`Delete table "${editingTable.label}"? This cannot be undone.`)
    ) {
      return;
    }
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteTable(editingTable.id);
      if (result?.error) {
        setDeleteError(result.error);
      } else {
        onClose();
      }
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Server action errors */}
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="text-xs text-red-600">
          {deleteError}
        </p>
      )}

      {/* Hidden fields */}
      {editingTable && (
        <input type="hidden" name="id" value={editingTable.id} />
      )}
      <input type="hidden" name="floor_plan_id" value={planId} />
      <input type="hidden" name="zone" value={zoneJson} />

      <div className="flex flex-wrap gap-3">
        {/* Label */}
        <div className="w-28">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Label
          </label>
          <input
            name="label"
            type="text"
            required
            maxLength={20}
            defaultValue={editingTable?.label ?? ""}
            placeholder="e.g. T1"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* Capacity */}
        <div className="w-24">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Capacity
          </label>
          <input
            name="capacity"
            type="number"
            required
            min={1}
            max={50}
            defaultValue={editingTable?.capacity ?? 4}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>

        {/* is_bookable */}
        <div className="flex items-end gap-2 pb-0.5">
          <input
            id={`bookable-${editingTable?.id ?? "new"}`}
            name="is_bookable"
            type="checkbox"
            value="true"
            defaultChecked={editingTable?.is_bookable ?? true}
            onChange={(e) => {
              const hidden =
                e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                  'input[type="hidden"][name="is_bookable"]'
                );
              if (hidden) hidden.disabled = e.currentTarget.checked;
            }}
            className="h-4 w-4 rounded border-gray-300"
          />
          <input
            type="hidden"
            name="is_bookable"
            value="false"
            disabled={editingTable?.is_bookable ?? true}
          />
          <label
            htmlFor={`bookable-${editingTable?.id ?? "new"}`}
            className="text-xs font-medium text-gray-600"
          >
            Bookable
          </label>
        </div>
      </div>

      {/* Zone geometry */}
      <div className="rounded-md border border-gray-200 p-3 space-y-3 bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-600">Shape:</span>
          <label className="flex items-center gap-1 text-xs text-gray-700">
            <input
              type="radio"
              name="shape_mode_ui"
              value="rect"
              checked={zoneType === "rect"}
              onChange={() => setZoneType("rect")}
            />
            Rectangle
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-700">
            <input
              type="radio"
              name="shape_mode_ui"
              value="circle"
              checked={zoneType === "circle"}
              onChange={() => setZoneType("circle")}
            />
            Circle
          </label>
        </div>

        {zoneType === "rect" ? (
          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "X", value: rx, setter: setRx, min: 0, max: planWidth },
                { label: "Y", value: ry, setter: setRy, min: 0, max: planHeight },
                { label: "W", value: rw, setter: setRw, min: 10, max: planWidth },
                { label: "H", value: rh, setter: setRh, min: 10, max: planHeight },
              ] as const
            ).map(({ label, value, setter, min, max }) => (
              <div key={label} className="w-20">
                <label className="block text-[10px] font-medium text-gray-500 mb-0.5">
                  {label}
                </label>
                <input
                  type="number"
                  value={value}
                  min={min}
                  max={max}
                  onChange={(e) => setter(parseInt(e.target.value, 10) || 0)}
                  className="block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-gray-900 focus:outline-none"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "CX", value: cx, setter: setCx, min: 0, max: planWidth },
                { label: "CY", value: cy, setter: setCy, min: 0, max: planHeight },
                { label: "R", value: cr, setter: setCr, min: 5, max: Math.min(planWidth, planHeight) },
              ] as const
            ).map(({ label, value, setter, min, max }) => (
              <div key={label} className="w-20">
                <label className="block text-[10px] font-medium text-gray-500 mb-0.5">
                  {label}
                </label>
                <input
                  type="number"
                  value={value}
                  min={min}
                  max={max}
                  onChange={(e) => setter(parseInt(e.target.value, 10) || 0)}
                  className="block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-gray-900 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <UpsertSubmitButton />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        {editingTable && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete table"}
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// ZoneEditor — the main exported component
// ---------------------------------------------------------------------------

interface ZoneEditorProps {
  plan: FloorPlan;
  tables: FloorTable[];
}

export function ZoneEditor({ plan, tables }: ZoneEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [shapeMode, setShapeMode] = useState<ShapeMode>("rect");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [drawnZone, setDrawnZone] = useState<TableZone | null>(null);
  const [showForm, setShowForm] = useState(false);

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;

  // ---------------------------------------------------------------------------
  // Pointer event handlers for canvas drawing
  // ---------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      // Only on background (target == SVG or image), not on a table shape.
      if (e.target !== svgRef.current && (e.target as Element).tagName !== "image") {
        return;
      }
      if (!svgRef.current) return;
      e.preventDefault();
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      const { x, y } = svgToLogical(e, svgRef.current, plan.width, plan.height);
      setDrag({ startX: x, startY: y, currentX: x, currentY: y });
      // Deselect any selected table when drawing new
      setSelectedTableId(null);
      setShowForm(false);
    },
    [plan.width, plan.height]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      if (!drag || !svgRef.current) return;
      e.preventDefault();
      const { x, y } = svgToLogical(e, svgRef.current, plan.width, plan.height);
      setDrag((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));
    },
    [drag, plan.width, plan.height]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      if (!drag) return;
      e.preventDefault();
      const zone = dragToZone(drag, shapeMode);
      setDrag(null);
      if (zone) {
        setDrawnZone(zone);
        setSelectedTableId(null);
        setShowForm(true);
      }
    },
    [drag, shapeMode]
  );

  // ---------------------------------------------------------------------------
  // Table click handler
  // ---------------------------------------------------------------------------

  const handleTableClick = useCallback((tableId: string) => {
    setSelectedTableId(tableId);
    setDrawnZone(null);
    setShowForm(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Close/cancel form
  // ---------------------------------------------------------------------------

  const handleCloseForm = useCallback(() => {
    setShowForm(false);
    setSelectedTableId(null);
    setDrawnZone(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-600">Draw shape:</span>
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setShapeMode("rect")}
            className={[
              "px-3 py-1.5 font-medium",
              shapeMode === "rect"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50",
            ].join(" ")}
          >
            Rectangle
          </button>
          <button
            type="button"
            onClick={() => setShapeMode("circle")}
            className={[
              "px-3 py-1.5 font-medium border-l border-gray-300",
              shapeMode === "circle"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50",
            ].join(" ")}
          >
            Circle
          </button>
        </div>
        <span className="text-xs text-gray-400">
          Drag on the canvas to draw a new table zone. Click an existing table
          to edit.
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-500 opacity-85" />
          Bookable
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-gray-400 opacity-55" />
          Non-bookable
        </span>
      </div>

      {/* Canvas */}
      <div className="overflow-auto rounded-lg border border-gray-200 bg-gray-100">
        <div
          style={{ minWidth: "100%" }}
          className="relative"
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${plan.width} ${plan.height}`}
            style={{
              width: "100%",
              maxWidth: plan.width,
              aspectRatio: `${plan.width} / ${plan.height}`,
              display: "block",
              touchAction: "none",
              cursor: drag ? "crosshair" : shapeMode === "rect" ? "crosshair" : "cell",
              userSelect: "none",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Background: image or grid pattern */}
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
                    id={`grid-${plan.id}`}
                    width={50}
                    height={50}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M 50 0 L 0 0 0 50`}
                      fill="none"
                      stroke="#d1d5db"
                      strokeWidth={1}
                    />
                  </pattern>
                </defs>
                <rect
                  width={plan.width}
                  height={plan.height}
                  fill="#f9fafb"
                />
                <rect
                  width={plan.width}
                  height={plan.height}
                  fill={`url(#grid-${plan.id})`}
                />
              </>
            )}

            {/* Existing tables */}
            {tables.map((table) => (
              <TableShape
                key={table.id}
                table={table}
                isSelected={table.id === selectedTableId}
                onClick={() => handleTableClick(table.id)}
              />
            ))}

            {/* Drag preview */}
            {drag && <DragPreview drag={drag} mode={shapeMode} />}
          </svg>
        </div>
      </div>

      {/* Empty state */}
      {tables.length === 0 && !showForm && (
        <p className="text-xs text-gray-400">
          No tables yet. Drag on the canvas above to draw your first table zone.
        </p>
      )}

      {/* Table create/edit form */}
      {showForm && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">
            {selectedTable ? `Edit table: ${selectedTable.label}` : "New table"}
          </h3>
          <TableForm
            key={selectedTable?.id ?? "new"}
            planId={plan.id}
            planWidth={plan.width}
            planHeight={plan.height}
            editingTable={selectedTable}
            drawnZone={drawnZone}
            onClose={handleCloseForm}
          />
        </div>
      )}
    </div>
  );
}
