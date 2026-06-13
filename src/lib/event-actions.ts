"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import {
  expireStaleReservedTickets,
  getEventAvailability,
} from "@/lib/event-queries";
import type { Profile, EventTicketStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared action state type
// ---------------------------------------------------------------------------

/** Returned by event server actions.  null = success. */
export type EventActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// requireTenantStaff (local copy - follows floor-actions.ts / reservation-actions.ts pattern)
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated profile when the caller is a restaurant_owner or
 * restaurant_staff with a non-null tenant_id.
 *
 * Returns null for: unauthenticated requests, super_admin (no tenant_id),
 * visitor role, or owner/staff without a tenant association.
 */
async function requireTenantStaff(): Promise<Profile | null> {
  const profile = await getProfile();
  if (!profile) return null;
  if (
    profile.role !== "restaurant_owner" &&
    profile.role !== "restaurant_staff"
  ) {
    return null;
  }
  if (!profile.tenant_id) return null;
  return profile;
}

// ---------------------------------------------------------------------------
// Revalidation helper
// ---------------------------------------------------------------------------

/**
 * Revalidates the B2B dashboard events path and the public B2C tenant events
 * path so both views reflect the latest state after any write.
 */
async function revalidateEventPaths(tenantId: string): Promise<void> {
  revalidatePath("/dashboard/events");

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/events`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Error mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps Postgres error codes (and capacity-trigger message substrings) to
 * user-friendly messages.
 *
 * Capacity-trigger RAISE:
 *   The check_event_capacity trigger uses a plain `raise exception` in PL/pgSQL
 *   which produces error code P0001 (raise_exception).  The message format is:
 *     "event <uuid> is at capacity (capacity=<n>, active_qty=<n>, requested=<n>)"
 *   We match on the substring "is at capacity" to produce a friendly message.
 *
 * 23P01 - exclusion constraint violation (not used for events, but kept for
 *          completeness / future FK overlaps).
 * 23505 - unique constraint violation (duplicate row).
 * 23514 - check constraint violation (e.g. starts_at > ends_at).
 */
function mapDbError(
  code: string | undefined,
  message: string | undefined,
  defaultMsg: string
): string {
  // Capacity trigger: plpgsql RAISE EXCEPTION produces code P0001.
  if (
    code === "P0001" &&
    message?.includes("is at capacity")
  ) {
    return "Not enough tickets remaining.";
  }
  // Also guard against the "event does not exist" raise from the capacity trigger.
  if (code === "P0001" && message?.includes("does not exist")) {
    return "Event not found.";
  }
  if (code === "23P01") {
    return "A scheduling conflict exists - please try again.";
  }
  if (code === "23505") {
    return "A duplicate record already exists.";
  }
  if (code === "23514") {
    return "One or more values violated a database constraint. Please check your input.";
  }
  return defaultMsg;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** ISO-8601 datetime string validator (non-empty). */
const isoDateSchema = z
  .string()
  .min(1, { message: "Date is required." })
  .refine((v) => !isNaN(new Date(v).getTime()), {
    message: "Must be a valid ISO-8601 date-time string.",
  });

const eventWriteSchema = z
  .object({
    title: z
      .string()
      .min(1, { message: "Title is required." })
      .max(160, { message: "Title must be 160 characters or fewer." }),
    description: z
      .string()
      .max(4000, { message: "Description must be 4000 characters or fewer." })
      .optional()
      .or(z.literal("").transform(() => undefined)),
    capacity: z
      .string()
      .transform((v) => parseInt(v, 10))
      .pipe(
        z
          .number()
          .int()
          .min(1, { message: "Capacity must be at least 1." })
          .max(10000, { message: "Capacity must be at most 10 000." })
      ),
    price_cents: z
      .string()
      .transform((v) => parseInt(v, 10))
      .pipe(
        z
          .number()
          .int()
          .min(0, { message: "Price must be 0 or greater." })
          .max(10_000_000, { message: "Price must be at most 10 000 000 cents." })
      ),
    currency: z.enum(["usd", "eur", "gbp", "rub"], {
      message: "Currency must be one of usd, eur, gbp, rub.",
    }),
    starts_at: isoDateSchema,
    ends_at: z
      .string()
      .optional()
      .or(z.literal("").transform(() => undefined))
      .refine(
        (v) => v === undefined || !isNaN(new Date(v!).getTime()),
        { message: "ends_at must be a valid ISO-8601 date-time string." }
      ),
    is_published: z
      .string()
      .optional()
      .transform((v) => v === "true" || v === "on" || v === "1"),
  })
  .refine(
    (data) => {
      if (!data.ends_at) return true;
      return new Date(data.starts_at) < new Date(data.ends_at);
    },
    { message: "ends_at must be later than starts_at.", path: ["ends_at"] }
  );

const purchaseTicketsSchema = z.object({
  tenant_id: z.string().uuid({ message: "Invalid tenant id." }),
  event_id: z.string().uuid({ message: "Invalid event id." }),
  quantity: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1, { message: "Quantity must be at least 1." })
        .max(100, { message: "Quantity must be at most 100." })
    ),
  buyer_name: z
    .string()
    .min(1, { message: "Buyer name is required." })
    .max(120, { message: "Buyer name must be 120 characters or fewer." }),
  buyer_email: z
    .string()
    .email({ message: "Please enter a valid email address." })
    .max(254, { message: "Email must be 254 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  buyer_phone: z
    .string()
    .min(5, { message: "Phone number must be at least 5 characters." })
    .max(40, { message: "Phone number must be 40 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const cancelMyTicketSchema = z.object({
  id: z.string().uuid({ message: "Invalid ticket id." }),
});

const staffUpdateTicketStatusSchema = z.object({
  id: z.string().uuid({ message: "Invalid ticket id." }),
  status: z.enum(["reserved", "paid", "cancelled", "refunded"], {
    message: "Invalid ticket status.",
  }),
  tenant_id: z.string().uuid({ message: "Invalid tenant id." }),
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

/**
 * Server action: create a new event for the caller's tenant (staff/owner-facing).
 *
 * Validates all DB CHECK constraints in application code (title length,
 * description length, capacity range, price range, currency allowlist,
 * starts_at required, ends_at > starts_at when provided).
 *
 * FormData fields:
 *   title, description?, capacity, price_cents, currency,
 *   starts_at (ISO-8601), ends_at? (ISO-8601), is_published? (checkbox)
 *
 * Returns null on success; { error } on failure.
 */
export async function createEvent(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    title:        formData.get("title")        as string ?? "",
    description:  formData.get("description")  as string ?? "",
    capacity:     formData.get("capacity")     as string ?? "",
    price_cents:  formData.get("price_cents")  as string ?? "",
    currency:     formData.get("currency")     as string ?? "",
    starts_at:    formData.get("starts_at")    as string ?? "",
    ends_at:      formData.get("ends_at")      as string ?? "",
    is_published: formData.get("is_published") as string ?? "",
  };

  const result = eventWriteSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    title,
    description,
    capacity,
    price_cents,
    currency,
    starts_at,
    ends_at,
    is_published,
  } = result.data;

  const supabase = createClient();

  const { error: dbError } = await supabase.from("events").insert({
    tenant_id:   profile.tenant_id,
    title,
    description: description ?? null,
    capacity,
    price_cents,
    currency,
    starts_at:   new Date(starts_at).toISOString(),
    ends_at:     ends_at ? new Date(ends_at).toISOString() : null,
    is_published,
  });

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to create event. Please try again."
      ),
    };
  }

  await revalidateEventPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------

/**
 * Server action: update an existing event (staff/owner-facing).
 *
 * Additional application-layer guard: if the new capacity is less than the
 * current sold quantity (reserved+paid), the update is rejected with a
 * friendly error.  The DB capacity trigger only fires on event_tickets writes
 * (INSERT/UPDATE), not on events updates, so this check must live in the API
 * layer.
 *
 * FormData fields: id (UUID) + all eventWriteSchema fields.
 *
 * Returns null on success; { error } on failure.
 */
export async function updateEvent(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const id = (formData.get("id") as string ?? "").trim();
  if (!id) {
    return { error: "Event id is required." };
  }

  const raw = {
    title:        formData.get("title")        as string ?? "",
    description:  formData.get("description")  as string ?? "",
    capacity:     formData.get("capacity")     as string ?? "",
    price_cents:  formData.get("price_cents")  as string ?? "",
    currency:     formData.get("currency")     as string ?? "",
    starts_at:    formData.get("starts_at")    as string ?? "",
    ends_at:      formData.get("ends_at")      as string ?? "",
    is_published: formData.get("is_published") as string ?? "",
  };

  const result = eventWriteSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    title,
    description,
    capacity,
    price_cents,
    currency,
    starts_at,
    ends_at,
    is_published,
  } = result.data;

  // Guard: ensure new capacity >= current sold quantity.
  // The DB capacity trigger only fires on event_tickets INSERT/UPDATE, not on
  // events UPDATE, so we must check this ourselves.
  const supabase = createClient();

  const { data: ticketData, error: ticketError } = await supabase
    .from("event_tickets")
    .select("quantity")
    .eq("event_id", id)
    .eq("tenant_id", profile.tenant_id)
    .in("status", ["reserved", "paid"]);

  if (ticketError) {
    return { error: "Failed to verify current ticket count. Please try again." };
  }

  const currentSold = ((ticketData ?? []) as { quantity: number }[]).reduce(
    (acc, row) => acc + row.quantity,
    0
  );

  if (capacity < currentSold) {
    return {
      error: `Cannot reduce capacity below current sold quantity (${currentSold} tickets already sold or reserved).`,
    };
  }

  const { error: dbError } = await supabase
    .from("events")
    .update({
      title,
      description: description ?? null,
      capacity,
      price_cents,
      currency,
      starts_at:   new Date(starts_at).toISOString(),
      ends_at:     ends_at ? new Date(ends_at).toISOString() : null,
      is_published,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to update event. Please try again."
      ),
    };
  }

  await revalidateEventPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------

/**
 * Server action: delete an event (staff/owner-facing).
 *
 * Cascades to event_tickets via ON DELETE CASCADE at the database layer.
 *
 * @param id UUID of the event to delete.
 */
export async function deleteEvent(id: string): Promise<EventActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!id || typeof id !== "string") {
    return { error: "Invalid event id." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to delete event. Please try again."
      ),
    };
  }

  await revalidateEventPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// saveEventImage
// ---------------------------------------------------------------------------

/**
 * Server action: persist a freshly uploaded event image URL into the events row.
 *
 * Mirrors saveFloorPlanImage exactly:
 *   - url must use https://
 *   - url must originate from this project's Supabase storage (tenant-assets bucket)
 *   - the first path segment after "tenant-assets/" in the pathname must equal
 *     the caller's tenant_id (prevents cross-tenant URL injection)
 *
 * The actual file upload is performed client-side directly to Supabase Storage.
 * This action only records the resulting public URL.
 *
 * The write is double-scoped: tenant_id eq + RLS.
 *
 * @param eventId UUID of the event to update.
 * @param url     Public HTTPS URL from Supabase Storage.
 */
export async function saveEventImage(
  eventId: string,
  url: string
): Promise<EventActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  if (!eventId || typeof eventId !== "string") {
    return { error: "Invalid event id." };
  }

  if (!url.startsWith("https://")) {
    return { error: "Image URL must use the https:// protocol." };
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const storagePrefix = `${supabaseUrl}/storage/v1/object/public/tenant-assets/`;
  if (!url.startsWith(storagePrefix)) {
    return {
      error: "Image URL must point to this project's tenant-assets storage.",
    };
  }

  let parsedPathname: string;
  try {
    parsedPathname = new URL(url).pathname;
  } catch {
    return { error: "Image URL is not a valid URL." };
  }

  const segments = parsedPathname.split("/").filter(Boolean);
  // pathname: /storage/v1/object/public/tenant-assets/<tenant_id>/...
  const bucketIndex = segments.indexOf("tenant-assets");
  const firstFolder = bucketIndex !== -1 ? segments[bucketIndex + 1] : undefined;

  if (firstFolder !== profile.tenant_id) {
    return { error: "Image URL does not belong to your tenant folder." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("events")
    .update({ image_url: url })
    .eq("id", eventId)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return { error: "Failed to save image URL. Please try again." };
  }

  await revalidateEventPaths(profile.tenant_id!);
  return null;
}

// ---------------------------------------------------------------------------
// purchaseTickets
// ---------------------------------------------------------------------------

/**
 * Server action: purchase tickets for an event (visitor/guest-facing).
 *
 * SECURITY: The client NEVER provides a price.  This action always reads
 * events.price_cents and events.currency server-side and writes those values
 * as the snapshot on the ticket row.  Any price field submitted in the form
 * is silently ignored.
 *
 * Flow:
 *   1. Expire stale reserved holds for this event (lazy cleanup).
 *   2. Load the event server-side; verify published, tenant active, starts_at
 *      in the future.
 *   3. Check availability: remaining >= quantity.
 *   4. Snapshot price/currency from the event row.
 *   5a. Authenticated user → insert via session client (RLS WITH CHECK enforces
 *       user_id = auth.uid(), status = 'reserved', tenant active, event published).
 *   5b. Anonymous guest → insert via admin client (bypasses RLS); explicit
 *       tenant-active + published re-checks at the application layer.
 *   6. Free events (price_cents = 0): the RLS visitor INSERT WITH CHECK requires
 *      status = 'reserved'.  After the insert we immediately flip the row to
 *      'paid' via the admin client (service-role bypasses the guard trigger) so
 *      the ticket is immediately usable without a Stripe payment step.
 *      This approach is used for BOTH authenticated and guest paths to keep a
 *      single, consistent code path for the status flip.
 *   7. Map the capacity-trigger RAISE (P0001 + "is at capacity") to a friendly
 *      error; also map 23505/23514 generically.
 *
 * FormData fields:
 *   tenant_id, event_id, quantity (1–100), buyer_name, buyer_email?,
 *   buyer_phone?
 *   NOTE: no price field is accepted; the server always reads the live price.
 *
 * Returns null on success; { error } on failure.
 */
export async function purchaseTickets(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  // --- Parse & validate form data (price field intentionally absent) ---
  const raw = {
    tenant_id:   formData.get("tenant_id")   as string ?? "",
    event_id:    formData.get("event_id")    as string ?? "",
    quantity:    formData.get("quantity")    as string ?? "",
    buyer_name:  formData.get("buyer_name")  as string ?? "",
    buyer_email: formData.get("buyer_email") as string ?? "",
    buyer_phone: formData.get("buyer_phone") as string ?? "",
  };

  const result = purchaseTicketsSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const { tenant_id, event_id, quantity, buyer_name, buyer_email, buyer_phone } =
    result.data;

  // 1. Expire stale reserved holds for this event.
  await expireStaleReservedTickets(event_id);

  // 2. Load the event server-side.
  //    Use session client - RLS enforces is_published=true and tenant active
  //    for anonymous/visitor callers on the events table.
  const supabase = createClient();

  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("id, tenant_id, is_published, starts_at, capacity, price_cents, currency")
    .eq("id", event_id)
    .eq("tenant_id", tenant_id)
    .single();

  if (eventError || !eventData) {
    return { error: "Event not found or is not available for purchase." };
  }

  type EventRow = {
    id: string;
    tenant_id: string;
    is_published: boolean;
    starts_at: string;
    capacity: number;
    price_cents: number;
    currency: "usd" | "eur" | "gbp" | "rub";
  };
  const ev = eventData as EventRow;

  // Verify published (belt-and-suspenders over RLS on the authenticated path;
  // primary guard on the guest path since RLS is bypassed by admin client later).
  if (!ev.is_published) {
    return { error: "This event is not open for ticket purchases." };
  }

  // Verify event is in the future.
  if (new Date(ev.starts_at) <= new Date()) {
    return { error: "This event has already started or passed." };
  }

  // 3. Check availability (uses admin client internally, after expiry sweep).
  const availability = await getEventAvailability(event_id);
  if (!availability) {
    return { error: "Could not check event availability. Please try again." };
  }

  if (availability.remaining < quantity) {
    return {
      error: `Not enough tickets remaining. Only ${availability.remaining} ticket(s) left.`,
    };
  }

  // 4. Snapshot price/currency from the server-loaded event row.
  const unit_price_cents = ev.price_cents;
  const currency = ev.currency;
  const isFree = unit_price_cents === 0;

  // 5. Determine caller and insert strategy.
  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData?.user ?? null;

  let insertedId: string | null = null;

  if (authUser) {
    // 5a. Authenticated path: insert via session client (RLS enforces
    //     user_id = auth.uid(), status = 'reserved', tenant active, event published).
    const { data: insertData, error: dbError } = await supabase
      .from("event_tickets")
      .insert({
        tenant_id,
        event_id,
        user_id:         authUser.id,
        buyer_name,
        buyer_email:     buyer_email ?? null,
        buyer_phone:     buyer_phone ?? null,
        quantity,
        unit_price_cents,
        currency,
        status:          "reserved",
      })
      .select("id")
      .single();

    if (dbError) {
      return {
        error: mapDbError(
          dbError.code,
          dbError.message,
          "Failed to purchase tickets. Please try again."
        ),
      };
    }

    insertedId = (insertData as { id: string } | null)?.id ?? null;
  } else {
    // 5b. Anonymous guest path: use service-role admin client (bypasses RLS).
    // Explicitly re-verify tenant is active and event is published since RLS
    // is bypassed.
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("status")
      .eq("id", tenant_id)
      .single();

    if (tenantError || !tenantData) {
      return { error: "Tenant not found." };
    }

    if ((tenantData as { status: string }).status !== "active") {
      return { error: "This restaurant is not currently accepting ticket purchases." };
    }

    const adminClient = createAdminClient();

    const { data: insertData, error: dbError } = await adminClient
      .from("event_tickets")
      .insert({
        tenant_id,
        event_id,
        user_id:         null,
        buyer_name,
        buyer_email:     buyer_email ?? null,
        buyer_phone:     buyer_phone ?? null,
        quantity,
        unit_price_cents,
        currency,
        status:          "reserved",
      })
      .select("id")
      .single();

    if (dbError) {
      return {
        error: mapDbError(
          dbError.code,
          dbError.message,
          "Failed to purchase tickets. Please try again."
        ),
      };
    }

    insertedId = (insertData as { id: string } | null)?.id ?? null;
  }

  // 6. Free events: immediately flip status to 'paid' via admin client.
  //    Rationale: the RLS visitor INSERT WITH CHECK requires status='reserved',
  //    so we cannot insert 'paid' directly via session client.  Instead, we
  //    insert 'reserved' (satisfying RLS) then update to 'paid' via service-role
  //    (which bypasses the guard_visitor_ticket_update trigger that would
  //    normally reject the reserved→paid transition for visitors).
  //    This path is identical for both authenticated and guest tickets.
  if (isFree && insertedId) {
    const adminClient = createAdminClient();

    const { error: flipError } = await adminClient
      .from("event_tickets")
      .update({ status: "paid" })
      .eq("id", insertedId);

    if (flipError) {
      // Non-fatal: ticket exists in 'reserved' state; Stripe/webhook can flip
      // it later.  Log but do not surface error to the buyer.
      console.error(
        "[purchaseTickets] Failed to flip free ticket to paid:",
        flipError
      );
    }
  }

  await revalidateEventPaths(tenant_id);
  return null;
}

// ---------------------------------------------------------------------------
// cancelMyTicket
// ---------------------------------------------------------------------------

/**
 * Server action: cancel a reserved ticket owned by the authenticated visitor.
 *
 * Uses the caller's session client so RLS (visitor cancel own policy) and the
 * guard_visitor_ticket_update trigger jointly enforce:
 *   - Only the owner's rows are matched (user_id = auth.uid()).
 *   - Only reserved → cancelled transitions are permitted.
 *   - No other columns may change (trigger guard).
 *
 * @param id UUID of the ticket to cancel.
 */
export async function cancelMyTicket(id: string): Promise<EventActionState> {
  if (!id || typeof id !== "string") {
    return { error: "Invalid ticket id." };
  }

  const parsed = cancelMyTicketSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "You must be signed in to cancel a ticket." };
  }

  const { error: dbError } = await supabase
    .from("event_tickets")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("user_id", userData.user.id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    if (dbError.message?.includes("permission denied")) {
      return {
        error:
          "This ticket cannot be cancelled (it may already be cancelled, paid, or refunded).",
      };
    }
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to cancel ticket. Please try again."
      ),
    };
  }

  // Fetch tenant_id for path revalidation.
  const { data: ticketData } = await supabase
    .from("event_tickets")
    .select("tenant_id")
    .eq("id", parsed.data.id)
    .single();

  if (ticketData?.tenant_id) {
    await revalidateEventPaths(ticketData.tenant_id as string);
  }

  return null;
}

// ---------------------------------------------------------------------------
// staffUpdateTicketStatus
// ---------------------------------------------------------------------------

/**
 * Server action: update the status of an event ticket (staff/owner-facing).
 *
 * Uses the caller's session client double-scoped to their profile.tenant_id.
 * RLS (tenant role update own) provides the database-layer backstop.
 *
 * Capacity enforcement: when flipping a cancelled/refunded ticket BACK to
 * 'reserved' or 'paid', the check_event_capacity trigger re-fires and may
 * raise P0001 if the event is now at capacity.  This is mapped to a friendly
 * error via mapDbError.
 *
 * FormData fields: id (UUID), status ('reserved'|'paid'|'cancelled'|'refunded'),
 * tenant_id (UUID - double-scope confirmation)
 */
export async function staffUpdateTicketStatus(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const profile = await requireTenantStaff();
  if (!profile) {
    return { error: "You must be signed in as restaurant staff or owner." };
  }

  const raw = {
    id:        formData.get("id")        as string ?? "",
    status:    formData.get("status")    as string ?? "",
    tenant_id: formData.get("tenant_id") as string ?? "",
  };

  const result = staffUpdateTicketStatusSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  // Reject if the tenant_id in the form does not match the staff's own tenant.
  if (result.data.tenant_id !== profile.tenant_id) {
    return { error: "You do not have permission to update this ticket." };
  }

  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("event_tickets")
    .update({ status: result.data.status as EventTicketStatus })
    .eq("id", result.data.id)
    .eq("tenant_id", profile.tenant_id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to update ticket status. Please try again."
      ),
    };
  }

  await revalidateEventPaths(profile.tenant_id!);
  return null;
}
