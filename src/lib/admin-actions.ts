"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { TenantStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AdminActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * slug: ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$  (matches the DB constraint).
 * The regex requires exactly the same format as tenants_slug_format in SQL.
 */
const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
    message:
      "Slug must be 3–63 characters, lowercase alphanumeric and hyphens, not starting or ending with a hyphen.",
  });

/**
 * Hostname without protocol: e.g. "www.example.com" or "restaurant.io".
 * Rejects any value that starts with http:// or https://.
 */
const hostnameSchema = z
  .string()
  .regex(/^(?!https?:\/\/)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/, {
    message:
      "Custom domain must be a plain hostname without a protocol (e.g. www.example.com).",
  });

const createTenantSchema = z.object({
  slug: slugSchema,
  name: z
    .string()
    .min(1, { message: "Name is required." })
    .max(120, { message: "Name must be 120 characters or fewer." }),
  custom_domain: hostnameSchema.optional().or(z.literal("").transform(() => undefined)),
});

const updateTenantSchema = z.object({
  tenant_id: z.string().uuid({ message: "Invalid tenant ID." }),
  name: z
    .string()
    .min(1, { message: "Name is required." })
    .max(120, { message: "Name must be 120 characters or fewer." }),
  custom_domain: hostnameSchema.optional().or(z.literal("").transform(() => undefined)),
});

const tenantStatusSchema = z.enum(["active", "suspended", "pending"]);

const basePriceSchema = z
  .number()
  .int({ message: "Price must be an integer." })
  .min(0, { message: "Price must be 0 or greater." });

const priceOverrideSchema = z
  .number()
  .int({ message: "Price override must be an integer." })
  .min(0, { message: "Price override must be 0 or greater." })
  .nullable();

// ---------------------------------------------------------------------------
// Postgres error code helpers
// ---------------------------------------------------------------------------

/** Postgres unique-violation code. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Maps a Supabase/Postgres error to a user-friendly message.
 * Returns null when the error is not a known unique violation.
 */
function mapDbError(err: { code?: string; message?: string }, context: "tenant" | "module" = "tenant"): string | null {
  if (err.code !== PG_UNIQUE_VIOLATION) return null;

  const msg = err.message ?? "";

  if (context === "tenant") {
    if (msg.includes("tenants_slug_key") || msg.includes("slug")) {
      return "Slug is already taken. Please choose a different slug.";
    }
    if (msg.includes("tenants_custom_domain_key") || msg.includes("custom_domain")) {
      return "Domain is already in use by another tenant.";
    }
    // Generic tenant unique violation fallback.
    return "A tenant with that slug or domain already exists.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// createTenant
// ---------------------------------------------------------------------------

/**
 * Server action: create a new tenant.
 *
 * Note: slug is immutable post-creation by policy — once a tenant is created,
 * its slug cannot be changed (it serves as the subdomain identifier and may be
 * referenced in DNS / external systems).  Use `updateTenant` to edit name and
 * custom_domain only.
 *
 * On success: revalidates /admin/tenants and returns null.
 * On failure: returns { error: string } — never leaks raw Postgres details.
 */
export async function createTenant(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const raw = {
    slug: formData.get("slug"),
    name: formData.get("name"),
    custom_domain: formData.get("custom_domain") ?? undefined,
  };

  const result = createTenantSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid input." };
  }

  const { slug, name, custom_domain } = result.data;

  const supabase = createClient();

  const { error } = await supabase.from("tenants").insert({
    slug,
    name,
    ...(custom_domain ? { custom_domain } : {}),
    status: "active",
  });

  if (error) {
    const friendly = mapDbError(error, "tenant");
    if (friendly) return { error: friendly };
    // Do not return raw Postgres error text.
    return { error: "Failed to create tenant. Please try again." };
  }

  revalidatePath("/admin/tenants");
  return null;
}

// ---------------------------------------------------------------------------
// updateTenantStatus
// ---------------------------------------------------------------------------

/**
 * Server action: update the lifecycle status of a tenant.
 *
 * The DB trigger `guard_tenant_status_change` additionally enforces that only
 * super_admin sessions may change status — providing defence-in-depth beyond
 * the requireRole check here.
 *
 * On success: revalidates /admin/tenants and returns null.
 */
export async function updateTenantStatus(
  tenantId: string,
  status: TenantStatus
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const statusResult = tenantStatusSchema.safeParse(status);
  if (!statusResult.success) {
    return { error: "Invalid status value. Must be active, suspended, or pending." };
  }

  const idResult = z.string().uuid().safeParse(tenantId);
  if (!idResult.success) {
    return { error: "Invalid tenant ID." };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from("tenants")
    .update({ status: statusResult.data })
    .eq("id", tenantId);

  if (error) {
    return { error: "Failed to update tenant status. Please try again." };
  }

  revalidatePath("/admin/tenants");
  return null;
}

// ---------------------------------------------------------------------------
// updateTenant
// ---------------------------------------------------------------------------

/**
 * Server action: update mutable tenant fields (name, custom_domain).
 *
 * Slug is intentionally not editable here — it is immutable post-creation
 * because it forms the subdomain identifier and may be referenced in external
 * DNS records and bookmarked URLs.  Changing it would break live tenant sites.
 *
 * On success: revalidates /admin/tenants and returns null.
 */
export async function updateTenant(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const raw = {
    tenant_id: formData.get("tenant_id"),
    name: formData.get("name"),
    custom_domain: formData.get("custom_domain") ?? undefined,
  };

  const result = updateTenantSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid input." };
  }

  const { tenant_id, name, custom_domain } = result.data;

  const supabase = createClient();

  const { error } = await supabase
    .from("tenants")
    .update({
      name,
      // Setting to null clears the custom domain; omitting the key leaves it unchanged.
      // We always write the field so the user can clear it by submitting an empty string.
      custom_domain: custom_domain ?? null,
    })
    .eq("id", tenant_id);

  if (error) {
    const friendly = mapDbError(error, "tenant");
    if (friendly) return { error: friendly };
    return { error: "Failed to update tenant. Please try again." };
  }

  revalidatePath("/admin/tenants");
  return null;
}

// ---------------------------------------------------------------------------
// setTenantModule
// ---------------------------------------------------------------------------

/**
 * Server action: enable or disable a module for a tenant.
 *
 * Upserts a tenant_modules row (conflict on tenant_id,module_id).
 * When enabling a row that has never been enabled before (enabled_at IS NULL),
 * sets enabled_at = now().  Subsequent enable/disable cycles preserve the
 * original enabled_at timestamp.
 *
 * On success: revalidates /admin/tenants and returns null.
 */
export async function setTenantModule(
  tenantId: string,
  moduleId: string,
  enabled: boolean
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const tenantIdResult = z.string().uuid().safeParse(tenantId);
  if (!tenantIdResult.success) {
    return { error: "Invalid tenant ID." };
  }

  const moduleIdResult = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .safeParse(moduleId);
  if (!moduleIdResult.success) {
    return { error: "Invalid module ID." };
  }

  const supabase = createClient();

  // Check the current enabled_at value so we know whether to set it on enable.
  // We only set enabled_at on the first enable (when it was previously null).
  const { data: existing } = await supabase
    .from("tenant_modules")
    .select("enabled_at")
    .eq("tenant_id", tenantId)
    .eq("module_id", moduleId)
    .maybeSingle();

  const shouldSetEnabledAt = enabled && (existing === null || existing?.enabled_at === null);

  const { error } = await supabase
    .from("tenant_modules")
    .upsert(
      {
        tenant_id: tenantId,
        module_id: moduleId,
        enabled,
        ...(shouldSetEnabledAt ? { enabled_at: new Date().toISOString() } : {}),
      },
      { onConflict: "tenant_id,module_id" }
    );

  if (error) {
    return { error: "Failed to update module status. Please try again." };
  }

  revalidatePath("/admin/tenants");
  return null;
}

// ---------------------------------------------------------------------------
// setModulePriceOverride
// ---------------------------------------------------------------------------

/**
 * Server action: set or clear a per-tenant price override for a module.
 *
 * Passing null clears the override (tenant reverts to base price).
 * Passing an integer >= 0 sets the override in cents.
 *
 * Upserts the tenant_modules row on conflict (tenant_id, module_id).
 *
 * On success: revalidates /admin/tenants and returns null.
 */
export async function setModulePriceOverride(
  tenantId: string,
  moduleId: string,
  priceOverrideCents: number | null
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const tenantIdResult = z.string().uuid().safeParse(tenantId);
  if (!tenantIdResult.success) {
    return { error: "Invalid tenant ID." };
  }

  const moduleIdResult = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .safeParse(moduleId);
  if (!moduleIdResult.success) {
    return { error: "Invalid module ID." };
  }

  const priceResult = priceOverrideSchema.safeParse(priceOverrideCents);
  if (!priceResult.success) {
    const firstIssue = priceResult.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid price override value." };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from("tenant_modules")
    .upsert(
      {
        tenant_id: tenantId,
        module_id: moduleId,
        price_override_cents: priceResult.data,
      },
      { onConflict: "tenant_id,module_id" }
    );

  if (error) {
    return { error: "Failed to update price override. Please try again." };
  }

  revalidatePath("/admin/tenants");
  return null;
}

// ---------------------------------------------------------------------------
// updateModuleBasePrice
// ---------------------------------------------------------------------------

/**
 * Server action: update the platform-wide base price for a module.
 *
 * Validates basePriceCents >= 0 integer.
 * On success: revalidates /admin/tenants and /admin/modules, returns null.
 */
export async function updateModuleBasePrice(
  moduleId: string,
  basePriceCents: number
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const moduleIdResult = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .safeParse(moduleId);
  if (!moduleIdResult.success) {
    return { error: "Invalid module ID." };
  }

  const priceResult = basePriceSchema.safeParse(basePriceCents);
  if (!priceResult.success) {
    const firstIssue = priceResult.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid base price value." };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from("modules")
    .update({ base_price_cents: priceResult.data })
    .eq("id", moduleId);

  if (error) {
    return { error: "Failed to update module base price. Please try again." };
  }

  revalidatePath("/admin/tenants");
  revalidatePath("/admin/modules");
  return null;
}
