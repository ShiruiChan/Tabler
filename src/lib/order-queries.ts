import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  DeliverySettings,
  DeliveryZone,
  DeliveryScheduleDay,
  Order,
  OrderItem,
} from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Public composite types
// ---------------------------------------------------------------------------

/**
 * Delivery context loaded for the ordering page.
 *
 * Currency note: delivery_settings.currency is the single source of tenant
 * currency for all order types (in_session and delivery alike). Menu dishes
 * do not carry a currency column; the tenant's delivery_settings row is the
 * authoritative source.  If no delivery_settings row exists (should not happen
 * due to the auto-create trigger) the page falls back to 'usd'.
 */
export interface OrderingContext {
  settings: DeliverySettings | null;
  /** Active delivery zones only (is_active=true, tenant active - RLS enforced). */
  zones: DeliveryZone[];
  /**
   * True when the current UTC time falls within today's delivery schedule window.
   *
   * Logic:
   *   1. Look up today's weekday key (0=Sunday…6=Saturday, UTC) in settings.schedule.
   *   2. If the key is missing → closed.
   *   3. If the day entry has closed:true → closed.
   *   4. Parse open/close as "HH:MM" UTC wall-clock times and compare against
   *      the current UTC HH:MM.  Open ≤ now < close → open.
   *
   * Limitation: midnight-crossing windows (close ≤ open, e.g. 22:00–02:00)
   * are unsatisfiable under this comparison and therefore always treated as
   * closed (fails safe). Same-day windows only for now.
   *
   * This is used to gate delivery checkout in placeOrder AND to show a friendly
   * "delivery closed" notice on the UI.
   */
  deliveryOpenNow: boolean;
}

/**
 * An order row with its items nested.
 */
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether delivery is currently open given a DeliverySettings row
 * and the current UTC time.
 *
 * Exported so placeOrder can call the same logic without re-fetching settings.
 */
export function isDeliveryOpenNow(settings: DeliverySettings | null): boolean {
  if (!settings) return false;
  if (!settings.is_enabled) return false;

  const now = new Date();
  // JS Date.getDay() returns 0=Sun…6=Sat in LOCAL time; we need UTC.
  // getUTCDay() returns the same convention in UTC.
  const weekdayKey = String(now.getUTCDay()) as
    | "0" | "1" | "2" | "3" | "4" | "5" | "6";

  const dayEntry: DeliveryScheduleDay | undefined =
    settings.schedule[weekdayKey];

  if (!dayEntry) return false; // missing key = closed
  if (dayEntry.closed) return false;

  // Parse "HH:MM" times.
  const parseHHMM = (hhmm: string): number => {
    const [hh, mm] = hhmm.split(":").map(Number);
    return (hh ?? 0) * 60 + (mm ?? 0);
  };

  const openMins = parseHHMM(dayEntry.open);
  const closeMins = parseHHMM(dayEntry.close);
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  return nowMins >= openMins && nowMins < closeMins;
}

// ---------------------------------------------------------------------------
// getOrderingContext
// ---------------------------------------------------------------------------

/**
 * Returns the ordering context for the B2C order page:
 *   - delivery_settings singleton for this tenant (readable by anon + auth via
 *     public RLS when tenant is active)
 *   - active delivery zones (is_active=true, tenant active - public RLS)
 *   - whether delivery is open right now (derived from settings.schedule)
 *
 * Uses the session client (anon key); public RLS allows reading both tables
 * for active tenants regardless of auth state.  No staff check needed here.
 *
 * @param tenantId UUID of the tenant.
 */
export async function getOrderingContext(
  tenantId: string
): Promise<OrderingContext> {
  const supabase = createClient();

  // Parallel fetch: settings + zones.
  const [settingsRes, zonesRes] = await Promise.all([
    supabase
      .from("delivery_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .single(),
    supabase
      .from("delivery_zones")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const settings = (settingsRes.data as DeliverySettings | null) ?? null;
  const zones = (zonesRes.data as DeliveryZone[] | null) ?? [];

  return {
    settings,
    zones,
    deliveryOpenNow: isDeliveryOpenNow(settings),
  };
}

// ---------------------------------------------------------------------------
// getMyOrders
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated visitor's own orders with their items, most recent
 * first, filtered to a specific tenant.
 *
 * Cross-tenant filtering design decision:
 *   getMyOrders accepts a tenantId parameter and filters at the DB query level
 *   (`.eq("tenant_id", tenantId)` on both the orders query and the items query).
 *   This avoids the cross-tenant bleed minor noted in getMyTickets (which
 *   returned all tenants' tickets and relied on the caller to filter). By
 *   accepting tenantId here we keep the query tight and consistent with the
 *   recommended post-fix pattern.
 *
 * Authorization: requires an authenticated session.  RLS (visitor select own)
 * enforces that only rows where user_id = auth.uid() are returned.
 * Returns an empty array when unauthenticated or no orders exist.
 *
 * @param tenantId UUID of the tenant to scope the query.
 */
export async function getMyOrders(tenantId: string): Promise<OrderWithItems[]> {
  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return [];

  // Fetch orders for this tenant (RLS scopes to user_id = auth.uid()).
  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (ordersError || !ordersData || ordersData.length === 0) return [];

  const orders = ordersData as Order[];
  const orderIds = orders.map((o) => o.id);

  // Fetch items for these orders (RLS scopes to items whose parent order has
  // user_id = auth.uid() - see order_items visitor select own policy).
  const { data: itemsData } = await supabase
    .from("order_items")
    .select("*")
    .in("order_id", orderIds);

  const items = (itemsData ?? []) as OrderItem[];

  // Group items by order_id.
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const bucket = itemsByOrder.get(item.order_id) ?? [];
    bucket.push(item);
    itemsByOrder.set(item.order_id, bucket);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
  }));
}
