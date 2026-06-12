"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEvent, updateEvent, deleteEvent } from "@/lib/event-actions";
import type { EventWithStats } from "@/lib/event-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ISO timestamptz string (UTC) to the value format needed by
 * <input type="datetime-local">: "YYYY-MM-DDTHH:MM"
 */
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  // Slice to "YYYY-MM-DDTHH:MM" (datetime-local doesn't accept seconds/Z)
  return iso.slice(0, 16);
}

/**
 * Convert a datetime-local input value ("YYYY-MM-DDTHH:MM") to an ISO UTC
 * string.  The input is treated as UTC (project convention).
 */
function datetimeLocalToISO(value: string): string {
  if (!value) return "";
  // Append ":00Z" so Date() parses it as UTC
  return new Date(`${value}:00Z`).toISOString();
}

// ---------------------------------------------------------------------------
// Shared event fields
// ---------------------------------------------------------------------------

interface EventFieldsProps {
  id?: string; // present for edit, absent for create
  defaults?: Partial<EventWithStats>;
}

function EventFields({ id, defaults }: EventFieldsProps) {
  const priceMajor =
    defaults?.price_cents != null
      ? (defaults.price_cents / 100).toFixed(2)
      : "";

  // Checkbox controlled state for is_published (hidden-field pattern)
  const [isPublished, setIsPublished] = useState<boolean>(
    defaults?.is_published ?? false
  );

  return (
    <div className="space-y-3">
      {id && <input type="hidden" name="id" value={id} />}

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Title
        </label>
        <input
          name="title"
          type="text"
          required
          maxLength={160}
          defaultValue={defaults?.title ?? ""}
          placeholder="e.g. Jazz Night"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Description{" "}
          <span className="text-gray-400">(optional)</span>
        </label>
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={defaults?.description ?? ""}
          placeholder="Describe the event…"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      {/* Row: starts_at, ends_at */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Starts at{" "}
            <span className="text-gray-400">(UTC)</span>
          </label>
          <input
            name="starts_at"
            type="datetime-local"
            required
            defaultValue={isoToDatetimeLocal(defaults?.starts_at)}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Ends at{" "}
            <span className="text-gray-400">(UTC, optional)</span>
          </label>
          <input
            name="ends_at"
            type="datetime-local"
            defaultValue={isoToDatetimeLocal(defaults?.ends_at)}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Row: capacity, price, currency */}
      <div className="flex flex-wrap gap-3">
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Capacity
          </label>
          <input
            name="capacity"
            type="number"
            required
            min={1}
            max={10000}
            defaultValue={defaults?.capacity ?? 100}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Price ($)
          </label>
          <input
            name="price_cents"
            type="number"
            required
            min={0}
            step={0.01}
            defaultValue={priceMajor}
            placeholder="0.00"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="w-28">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Currency
          </label>
          <select
            name="currency"
            defaultValue={defaults?.currency ?? "usd"}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          >
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
            <option value="gbp">GBP</option>
            <option value="rub">RUB</option>
          </select>
        </div>
      </div>

      {/* is_published checkbox — hidden-field pattern (TASK-013/014) */}
      <div className="flex items-center gap-2">
        <input
          id={`is-published-${id ?? "new"}`}
          name="is_published"
          type="checkbox"
          value="true"
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        {/* Fallback hidden field so unchecked state sends "false" */}
        <input
          type="hidden"
          name="is_published"
          value="false"
          disabled={isPublished}
        />
        <label
          htmlFor={`is-published-${id ?? "new"}`}
          className="text-xs font-medium text-gray-600"
        >
          Published
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateEventForm
// ---------------------------------------------------------------------------

export function CreateEventForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    // Convert datetime-local values to ISO UTC strings before sending.
    const rawFd = new FormData(form);
    const fd = new FormData();

    Array.from(rawFd.entries()).forEach(([key, value]) => {
      if (key === "starts_at" || key === "ends_at") {
        const str = value as string;
        fd.set(key, str ? datetimeLocalToISO(str) : "");
      } else if (key === "price_cents") {
        // Convert price from major units to cents
        const dollars = parseFloat(value as string);
        fd.set(key, isNaN(dollars) ? "0" : String(Math.round(dollars * 100)));
      } else {
        fd.set(key, value as string);
      }
    });

    startTransition(async () => {
      setError(null);
      const result = await createEvent(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        // Success: reset the form and refresh server data
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-dashed border-gray-300 p-4"
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Create event
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <EventFields />

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create event"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// EditEventForm
// ---------------------------------------------------------------------------

interface EditEventFormProps {
  event: EventWithStats;
}

export function EditEventForm({ event }: EditEventFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    const rawFd = new FormData(form);
    const fd = new FormData();

    Array.from(rawFd.entries()).forEach(([key, value]) => {
      if (key === "starts_at" || key === "ends_at") {
        const str = value as string;
        fd.set(key, str ? datetimeLocalToISO(str) : "");
      } else if (key === "price_cents") {
        const dollars = parseFloat(value as string);
        fd.set(key, isNaN(dollars) ? "0" : String(Math.round(dollars * 100)));
      } else {
        fd.set(key, value as string);
      }
    });

    startTransition(async () => {
      setError(null);
      const result = await updateEvent(null, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete event "${event.title}"? All tickets will also be deleted. This cannot be undone.`)) {
      return;
    }
    startDeleteTransition(async () => {
      setDeleteError(null);
      const result = await deleteEvent(event.id);
      if (result?.error) {
        setDeleteError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="text-xs text-red-600">
          {deleteError}
        </p>
      )}

      <EventFields id={event.id} defaults={event} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || isDeleting}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save event"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending || isDeleting}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </form>
  );
}
