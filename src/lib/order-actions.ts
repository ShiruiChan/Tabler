"use server";

/**
 * order-actions.ts
 *
 * Server actions for the B2C ordering flow (TASK-029).
 *
 * Return-type design:
 *   placeOrder returns { error: string } | { success: OrderSuccess }.
 *   This discriminated union lets the UI branch on ok/error cleanly without
 *   needing a separate state mechanism: the success branch carries the order
 *   summary snapshot (order_id, total_cents, currency, estimated_minutes?) the
 *   confirmation panel needs.  The caller uses `"error" in result` to branch.
 *
 * Atomicity / compensation:
 *   PostgREST does not expose a multi-statement transaction across two .insert()
 *   calls. We therefore insert the order row first (step 1), then bulk-insert
 *   all order_items (step 2). If step 2 fails for any item we issue a
 *   compensating DELETE of the just-created order row (step 3) via the admin
 *   client. This is best-effort: if the compensating DELETE also fails the
 *   order row is left orphaned (no items) but in 'pending' status; staff can
 *   cancel/delete it from the dashboard. The limit of this approach is the
 *   TOCTOU window between steps 2 and 3 - a production system would use an RPC
 *   or DB function for true atomicity. No existing rpc/transaction pattern was
 *   found in the repo.
 *
 * Module gating decision:
 *   - MODULES.ordering gates the order page (in_session + delivery) at the
 *     page layer only. placeOrder itself performs NO module check - mirroring
 *     the approved purchaseTickets precedent (module gating is a billing
 *     toggle, not a security boundary). Server-side guards here are
 *     resource-state checks instead: tenant active, table bookable,
 *     zone active, delivery_settings.is_enabled + schedule window.
 *   Rationale: MODULES.ordering = 'ordering' exists in modules.ts. Using it as
 *   the page gate means the menu module is not required for ordering (correct -
 *   a restaurant could have ordering without a public menu page, or vice versa).
 *
 * Banquet rejection:
 *   order_type = 'banquet' is rejected by placeOrder with a clear message.
 *   Banquet deposit flow is TASK-031 and is not available in this release.
 *   The API could be extended to accept banquet orders cleanly when TASK-031
 *   is implemented; the rejection is at the application layer only.
 *
 * Currency snapshot:
 *   delivery_settings.currency is the single source of tenant currency for all
 *   order types (in_session and delivery alike). Menu dishes do not carry a
 *   currency column; the delivery_settings row is the authoritative source per
 *   the migration design notes. Default: 'usd' when settings row is missing.
 *
 * P0001 mappings (cross-tenant trigger raises from 0009_orders.sql):
 *   - "floor_table % does not exist"              → floor table not found
 *   - "floor_table % belongs to tenant"           → cross-tenant table
 *   - "delivery_zone % does not exist"            → zone not found
 *   - "delivery_zone % belongs to tenant"         → cross-tenant zone
 *   - "reservation % does not exist"              → reservation not found
 *   - "reservation % belongs to tenant"           → cross-tenant reservation
 *   - "order % does not exist"                    → order item cross-tenant
 *   - "order % belongs to tenant"                 → order item cross-tenant
 *   All produce a generic "security violation" friendly message.
 *
 * 23514 constraint name mappings:
 *   - orders_total_equals_subtotal_plus_fee       → total arithmetic error
 *   - orders_delivery_address_required            → delivery address missing
 *   All produce specific friendly messages.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Currency } from "@/lib/types/database";
import { isDeliveryOpenNow } from "@/lib/order-queries";
import type { DeliverySettings, DeliveryZone } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface OrderSuccess {
  order_id: string;
  total_cents: number;
  currency: Currency;
  /** Present only for delivery orders when settings.estimated_minutes is set. */
  estimated_minutes?: number;
}

export type PlaceOrderResult =
  | { success: OrderSuccess }
  | { error: string };

export type OrderActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Single item line in the items JSON array sent by the client. */
const orderItemInputSchema = z.object({
  dish_id: z.string().uuid({ message: "Invalid dish id in items." }),
  quantity: z
    .number()
    .int()
    .min(1, { message: "Item quantity must be at least 1." })
    .max(100, { message: "Item quantity must be at most 100." }),
});

const placeOrderSchema = z.object({
  tenant_id: z.string().uuid({ message: "Invalid tenant id." }),
  order_type: z.enum(["in_session", "delivery", "banquet"], {
    message: "order_type must be in_session, delivery, or banquet.",
  }),
  customer_name: z
    .string()
    .min(1, { message: "Customer name is required." })
    .max(120, { message: "Customer name must be 120 characters or fewer." }),
  customer_email: z
    .string()
    .email({ message: "Please enter a valid email address." })
    .max(254, { message: "Email must be 254 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  customer_phone: z
    .string()
    .min(5, { message: "Phone number must be at least 5 characters." })
    .max(40, { message: "Phone number must be 40 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z
    .string()
    .max(2000, { message: "Notes must be 2000 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // in_session
  table_id: z
    .string()
    .uuid({ message: "Invalid table id." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // delivery
  delivery_zone_id: z
    .string()
    .uuid({ message: "Invalid delivery zone id." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  delivery_address: z
    .string()
    .max(500, { message: "Delivery address must be 500 characters or fewer." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** JSON string of [{dish_id, quantity}], max 50 lines. */
  items: z
    .string()
    .min(1, { message: "Order items are required." }),
});

const cancelMyOrderSchema = z.object({
  id: z.string().uuid({ message: "Invalid order id." }),
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Maps Postgres error codes and message substrings to user-friendly messages.
 *
 * P0001 (raise_exception) covers:
 *   - Cross-tenant FK trigger messages from 0009_orders.sql (floor_table,
 *     delivery_zone, reservation, order_item cross-tenant guards).
 *   - Visitor guard trigger message for column immutability / wrong transition.
 *
 * 23514 (check_constraint_violation) covers:
 *   - orders_total_equals_subtotal_plus_fee (arithmetic mismatch)
 *   - orders_delivery_address_required      (delivery without address)
 *   - Any other column-range check.
 *
 * 23505 (unique_violation) - generic duplicate row.
 */
function mapDbError(
  code: string | undefined,
  message: string | undefined,
  defaultMsg: string
): string {
  // P0001 - trigger RAISE EXCEPTION
  if (code === "P0001") {
    // Cross-tenant trigger strings from 0009
    if (
      message?.includes("belongs to tenant") ||
      message?.includes("does not exist") ||
      message?.includes("permission denied")
    ) {
      return "Security violation: the submitted data references resources belonging to a different tenant.";
    }
    return defaultMsg;
  }

  // 23514 - check constraint violation
  if (code === "23514") {
    if (message?.includes("orders_total_equals_subtotal_plus_fee")) {
      return "Order total arithmetic mismatch - please try again.";
    }
    if (message?.includes("orders_delivery_address_required")) {
      return "A delivery address is required for delivery orders.";
    }
    return "One or more values violated a database constraint. Please check your input.";
  }

  // 23505 - unique violation
  if (code === "23505") {
    return "A duplicate record already exists.";
  }

  return defaultMsg;
}

// ---------------------------------------------------------------------------
// Revalidation helper
// ---------------------------------------------------------------------------

async function revalidateOrderPaths(tenantId: string): Promise<void> {
  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single();

  if (data?.slug) {
    revalidatePath(`/t/${data.slug}/order`);
    revalidatePath(`/t/${data.slug}`);
  }
}

// ---------------------------------------------------------------------------
// placeOrder
// ---------------------------------------------------------------------------

/**
 * Server action: place a new order (visitor/guest-facing).
 *
 * TASK-027 obligation compliance:
 *
 * 1. Price re-verification: dish unit prices are always read server-side from
 *    live dishes rows; client sends only dish_id + quantity. Dishes must be
 *    is_available=true, belong to this tenant, AND have an active category
 *    (menu_categories.is_active=true). subtotal is computed server-side.
 *
 * 2. Delivery fee resolution: zone.fee_override_cents ?? settings.base_fee_cents.
 *    free_delivery_over_cents threshold → fee=0 when subtotal ≥ threshold.
 *    Min order: zone.min_order_override_cents ?? settings.min_order_cents.
 *    Orders below minimum are rejected with a friendly message.
 *
 * 3. Status graph: only pending→cancelled is exposed to visitors (cancelMyOrder).
 *
 * 4. Type↔field presence:
 *    - in_session: requires table_id; table must belong to tenant + active plan.
 *    - delivery: requires delivery_address + (if zones exist) valid active
 *      zone_id of this tenant; requires settings.is_enabled AND current UTC
 *      time within today's schedule window.
 *    - banquet: explicitly rejected (TASK-031 not yet available).
 *
 * 5. Atomicity: order inserted first, then all items in a single bulk insert.
 *    On item-insert failure a compensating DELETE of the order row is issued
 *    via admin client. See file-level doc comment for limits.
 *
 * 6. Currency snapshot: from delivery_settings.currency for both delivery and
 *    in_session orders (single source of tenant currency).
 *
 * FormData fields:
 *   tenant_id, order_type (in_session|delivery), customer_name,
 *   customer_email?, customer_phone?, notes?, table_id? (in_session),
 *   delivery_zone_id?, delivery_address? (delivery),
 *   items (JSON string [{dish_id, quantity}], max 50 items)
 *
 * Returns { success: OrderSuccess } | { error: string }.
 */
export async function placeOrder(
  _prev: PlaceOrderResult | null,
  formData: FormData
): Promise<PlaceOrderResult> {
  // ── 1. Parse & validate form data ─────────────────────────────────────────
  const raw = {
    tenant_id:        formData.get("tenant_id")        as string ?? "",
    order_type:       formData.get("order_type")       as string ?? "",
    customer_name:    formData.get("customer_name")    as string ?? "",
    customer_email:   formData.get("customer_email")   as string ?? "",
    customer_phone:   formData.get("customer_phone")   as string ?? "",
    notes:            formData.get("notes")            as string ?? "",
    table_id:         formData.get("table_id")         as string ?? "",
    delivery_zone_id: formData.get("delivery_zone_id") as string ?? "",
    delivery_address: formData.get("delivery_address") as string ?? "",
    items:            formData.get("items")            as string ?? "",
  };

  const result = placeOrderSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input." };
  }

  const {
    tenant_id,
    order_type,
    customer_name,
    customer_email,
    customer_phone,
    notes,
    table_id,
    delivery_zone_id,
    delivery_address,
    items: itemsJson,
  } = result.data;

  // ── 2. Banquet rejection ───────────────────────────────────────────────────
  if (order_type === "banquet") {
    return {
      error:
        "Banquet pre-orders are not yet available online. Please contact us directly to arrange a banquet booking.",
    };
  }

  // ── 3. Parse items JSON ────────────────────────────────────────────────────
  let rawItems: unknown;
  try {
    rawItems = JSON.parse(itemsJson);
  } catch {
    return { error: "Invalid items format - expected a JSON array." };
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: "Your cart is empty. Please add items before placing an order." };
  }

  if (rawItems.length > 50) {
    return { error: "Orders may contain at most 50 distinct item lines." };
  }

  const parsedItemsResult = z
    .array(orderItemInputSchema)
    .safeParse(rawItems);

  if (!parsedItemsResult.success) {
    return {
      error:
        parsedItemsResult.error.issues[0]?.message ?? "Invalid items data.",
    };
  }

  const itemInputs = parsedItemsResult.data;

  // ── 4. Module + tenant validation ─────────────────────────────────────────
  const supabase = createClient();

  // Verify tenant active (the session client RLS will enforce this on insert
  // for authenticated visitors; for admin-client guest path we check explicitly).
  const { data: tenantData, error: tenantError } = await supabase
    .from("tenants")
    .select("status")
    .eq("id", tenant_id)
    .single();

  if (tenantError || !tenantData) {
    return { error: "Restaurant not found." };
  }

  if ((tenantData as { status: string }).status !== "active") {
    return { error: "This restaurant is not currently accepting orders." };
  }

  // ── 5. Load delivery settings (needed for currency + delivery validation) ─
  const { data: settingsData } = await supabase
    .from("delivery_settings")
    .select("*")
    .eq("tenant_id", tenant_id)
    .single();

  const settings = (settingsData as DeliverySettings | null) ?? null;

  // Currency snapshot: single source is delivery_settings.currency.
  const currency: Currency = settings?.currency ?? "usd";

  // ── 6. Type-specific validations ──────────────────────────────────────────

  if (order_type === "in_session") {
    // table_id required for in_session.
    if (!table_id) {
      return { error: "A table selection is required for dine-in orders." };
    }

    // Verify the table belongs to this tenant and is on an active floor plan.
    const { data: tableData, error: tableError } = await supabase
      .from("floor_tables")
      .select("id, tenant_id, floor_plan_id, is_bookable")
      .eq("id", table_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (tableError || !tableData) {
      return { error: "Selected table not found or does not belong to this restaurant." };
    }

    type TableRow = { id: string; tenant_id: string; floor_plan_id: string; is_bookable: boolean };
    const tbl = tableData as TableRow;

    if (!tbl.is_bookable) {
      return { error: "The selected table is not available for orders." };
    }

    // Verify the table's floor plan is active.
    const { data: planData, error: planError } = await supabase
      .from("floor_plans")
      .select("is_active")
      .eq("id", tbl.floor_plan_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (planError || !planData || !(planData as { is_active: boolean }).is_active) {
      return { error: "The selected table is not available (floor plan inactive)." };
    }
  }

  let resolvedDeliveryFee = 0;
  let resolvedZone: DeliveryZone | null = null;

  if (order_type === "delivery") {
    // Delivery switch must be on.
    if (!settings?.is_enabled) {
      return { error: "Delivery is not currently available at this restaurant." };
    }

    // Schedule check: delivery must be open right now (UTC).
    if (!isDeliveryOpenNow(settings)) {
      return {
        error:
          "Delivery is currently closed. Please check our delivery hours and try again later.",
      };
    }

    // delivery_address required.
    if (!delivery_address) {
      return { error: "A delivery address is required for delivery orders." };
    }

    // If zones exist, delivery_zone_id is required and must be active + belong to tenant.
    const { data: zonesData } = await supabase
      .from("delivery_zones")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("is_active", true);

    const zones = (zonesData ?? []) as DeliveryZone[];

    if (zones.length > 0) {
      if (!delivery_zone_id) {
        return { error: "Please select a delivery zone." };
      }

      resolvedZone = zones.find((z) => z.id === delivery_zone_id) ?? null;
      if (!resolvedZone) {
        return {
          error:
            "The selected delivery zone is not available. Please choose a valid zone.",
        };
      }
    } else if (delivery_zone_id) {
      // Zones exist check already done - if no zones but zone_id supplied, ignore it.
      // (No zones configured = no zone required.)
    }
  }

  // ── 7. Server-side price re-verification ──────────────────────────────────
  // Fetch all dishes being ordered: must be is_available, belong to tenant,
  // AND have an active category (is_active=true on menu_categories).
  const dishIds = itemInputs.map((i) => i.dish_id);

  const { data: dishesData, error: dishError } = await supabase
    .from("dishes")
    .select("id, tenant_id, category_id, name, price_cents, is_available")
    .eq("tenant_id", tenant_id)
    .eq("is_available", true)
    .in("id", dishIds);

  if (dishError) {
    return { error: "Failed to verify dish prices. Please try again." };
  }

  type DishRow = {
    id: string;
    tenant_id: string;
    category_id: string;
    name: string;
    price_cents: number;
    is_available: boolean;
  };
  const dishes = (dishesData ?? []) as DishRow[];

  // Check all active categories for the fetched dishes.
  const categoryIdSet = new Set(dishes.map((d) => d.category_id));
  const categoryIds = Array.from(categoryIdSet);

  const { data: categoriesData } = await supabase
    .from("menu_categories")
    .select("id, is_active")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .in("id", categoryIds);

  type CatRow = { id: string; is_active: boolean };
  const activeCategoryIds = new Set(
    ((categoriesData ?? []) as CatRow[]).map((c) => c.id)
  );

  // Build a lookup map: dish_id → dish row (only for available dishes in active categories).
  const dishMap = new Map<string, DishRow>();
  for (const d of dishes) {
    if (activeCategoryIds.has(d.category_id)) {
      dishMap.set(d.id, d);
    }
  }

  // Verify every ordered dish is valid; compute subtotal.
  let subtotal_cents = 0;

  for (const item of itemInputs) {
    const dish = dishMap.get(item.dish_id);
    if (!dish) {
      return {
        error: `One or more items are no longer available. Please refresh and try again.`,
      };
    }
    subtotal_cents += dish.price_cents * item.quantity;
  }

  if (subtotal_cents < 0 || subtotal_cents > 100_000_000) {
    return { error: "Order total is out of the allowed range." };
  }

  // ── 8. Delivery fee resolution ─────────────────────────────────────────────
  if (order_type === "delivery") {
    // Zone fee_override_cents ?? settings.base_fee_cents
    const baseFee =
      resolvedZone?.fee_override_cents != null
        ? resolvedZone.fee_override_cents
        : (settings?.base_fee_cents ?? 0);

    // free_delivery_over_cents threshold
    const freeOver = settings?.free_delivery_over_cents ?? null;
    resolvedDeliveryFee =
      freeOver != null && subtotal_cents >= freeOver ? 0 : baseFee;

    // Min order enforcement: zone override ?? settings base
    const minOrder =
      resolvedZone?.min_order_override_cents != null
        ? resolvedZone.min_order_override_cents
        : (settings?.min_order_cents ?? 0);

    if (minOrder > 0 && subtotal_cents < minOrder) {
      const sym =
        currency === "usd"
          ? "$"
          : currency === "eur"
          ? "€"
          : currency === "gbp"
          ? "£"
          : "₽";
      return {
        error: `Minimum delivery order is ${sym}${(minOrder / 100).toFixed(2)}. Please add more items.`,
      };
    }
  }

  const total_cents = subtotal_cents + resolvedDeliveryFee;

  // ── 9. Determine auth path ─────────────────────────────────────────────────
  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData?.user ?? null;

  // ── 10. Insert order row ──────────────────────────────────────────────────
  // Guest path uses admin client (bypasses RLS).
  // Authenticated path: for in_session/delivery orders by visitors the RLS
  // "visitor insert own" policy requires user_id=auth.uid(), status='pending',
  // and tenant active.  Using session client satisfies that.
  // However, we use the admin client for both paths for consistency and to
  // avoid the RLS restriction that requires user_id = auth.uid() on insert
  // (guest orders have user_id=null, which cannot go through session client RLS).
  // The admin client bypasses RLS; we re-verify tenant active above.
  const adminClient = createAdminClient();

  const orderInsert = {
    tenant_id,
    order_type,
    status: "pending" as const,
    user_id: authUser?.id ?? null,
    customer_name,
    customer_email: customer_email ?? null,
    customer_phone: customer_phone ?? null,
    notes: notes ?? null,
    table_id: order_type === "in_session" ? (table_id ?? null) : null,
    delivery_zone_id:
      order_type === "delivery" ? (delivery_zone_id ?? null) : null,
    delivery_address:
      order_type === "delivery" ? (delivery_address ?? null) : null,
    reservation_id: null,
    subtotal_cents,
    delivery_fee_cents: resolvedDeliveryFee,
    total_cents,
    currency,
    deposit_cents: 0,
    payment_ref: null,
  };

  const { data: insertedOrder, error: orderInsertError } = await adminClient
    .from("orders")
    .insert(orderInsert)
    .select("id")
    .single();

  if (orderInsertError || !insertedOrder) {
    return {
      error: mapDbError(
        orderInsertError?.code,
        orderInsertError?.message,
        "Failed to place order. Please try again."
      ),
    };
  }

  const orderId = (insertedOrder as { id: string }).id;

  // ── 11. Insert order_items (bulk) ─────────────────────────────────────────
  const itemRows = itemInputs.map((item) => {
    const dish = dishMap.get(item.dish_id)!;
    return {
      tenant_id,
      order_id: orderId,
      dish_id: item.dish_id,
      dish_name: dish.name,
      unit_price_cents: dish.price_cents,
      quantity: item.quantity,
    };
  });

  const { error: itemsInsertError } = await adminClient
    .from("order_items")
    .insert(itemRows);

  if (itemsInsertError) {
    // ── Compensating delete ─────────────────────────────────────────────────
    // Best-effort: if this also fails the order row is left orphaned in
    // 'pending' status with no items - staff can cancel it from the dashboard.
    await adminClient.from("orders").delete().eq("id", orderId);

    return {
      error: mapDbError(
        itemsInsertError.code,
        itemsInsertError.message,
        "Failed to save order items. Please try again."
      ),
    };
  }

  // ── 12. Revalidate paths ──────────────────────────────────────────────────
  await revalidateOrderPaths(tenant_id);

  return {
    success: {
      order_id: orderId,
      total_cents,
      currency,
      ...(order_type === "delivery" && settings?.estimated_minutes != null
        ? { estimated_minutes: settings.estimated_minutes }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// cancelMyOrder
// ---------------------------------------------------------------------------

/**
 * Server action: cancel a pending order owned by the authenticated visitor.
 *
 * Mirrors cancelMyTicket exactly.
 *
 * Uses the caller's session client so RLS (visitor cancel own policy) and the
 * guard_visitor_order_update trigger jointly enforce:
 *   - Only the owner's rows are matched (user_id = auth.uid()).
 *   - Only pending → cancelled transitions are permitted.
 *   - No other columns may change (trigger guard).
 *
 * @param id UUID of the order to cancel.
 */
export async function cancelMyOrder(id: string): Promise<OrderActionState> {
  if (!id || typeof id !== "string") {
    return { error: "Invalid order id." };
  }

  const parsed = cancelMyOrderSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "You must be signed in to cancel an order." };
  }

  const { error: dbError } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("user_id", userData.user.id); // double-scope: belt-and-suspenders over RLS

  if (dbError) {
    if (dbError.message?.includes("permission denied")) {
      return {
        error:
          "This order cannot be cancelled (it may already be confirmed, preparing, or cancelled).",
      };
    }
    return {
      error: mapDbError(
        dbError.code,
        dbError.message,
        "Failed to cancel order. Please try again."
      ),
    };
  }

  // Fetch tenant_id for path revalidation.
  const { data: orderData } = await supabase
    .from("orders")
    .select("tenant_id")
    .eq("id", parsed.data.id)
    .single();

  if (orderData?.tenant_id) {
    await revalidateOrderPaths(orderData.tenant_id as string);
  }

  return null;
}
