"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import { SITE_FONTS } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type DashboardActionState = { error: string } | null;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, {
    message: "Color must be a valid 6-digit hex value (e.g. #1a1a1a).",
  });

const optionalHttpsUrlSchema = z
  .string()
  .optional()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(
    z
      .string()
      .url({ message: "Must be a valid URL." })
      .refine((val) => val.startsWith("https://"), {
        message: "Social link URL must use the https:// protocol.",
      })
      .optional()
  );

const siteFontsEnum = z.enum(
  SITE_FONTS as unknown as [string, ...string[]],
  { message: "Font must be one of the supported web fonts." }
);

const updateSiteSettingsSchema = z.object({
  primary_color: hexColorSchema,
  secondary_color: hexColorSchema,
  accent_color: hexColorSchema,
  font_heading: siteFontsEnum,
  font_body: siteFontsEnum,
  tagline: z
    .string()
    .max(200, { message: "Tagline must be 200 characters or fewer." })
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  about: z
    .string()
    .max(2000, { message: "About text must be 2000 characters or fewer." })
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  instagram: optionalHttpsUrlSchema,
  facebook: optionalHttpsUrlSchema,
  x: optionalHttpsUrlSchema,
  tiktok: optionalHttpsUrlSchema,
  website: optionalHttpsUrlSchema,
});

// ---------------------------------------------------------------------------
// updateSiteSettings
// ---------------------------------------------------------------------------

/**
 * Server action: update the site design settings for the authenticated
 * restaurant_owner's tenant.
 *
 * Staff members are rejected — only the owner may change site design.
 * Zod validates all fields before writing to the database.
 * RLS on site_settings additionally enforces the owner-only UPDATE policy.
 *
 * Returns null on success or { error: string } on failure.
 */
export async function updateSiteSettings(
  _prev: DashboardActionState,
  formData: FormData
): Promise<DashboardActionState> {
  // --- Auth: require restaurant_owner with a tenant ---
  const profile = await getProfile();
  if (!profile) return { error: "You must be signed in." };
  if (profile.role !== "restaurant_owner") {
    return { error: "Only the owner can change site design." };
  }
  if (!profile.tenant_id) {
    return { error: "Your account is not associated with a restaurant." };
  }

  // --- Parse and validate form data ---
  const raw = {
    primary_color: formData.get("primary_color"),
    secondary_color: formData.get("secondary_color"),
    accent_color: formData.get("accent_color"),
    font_heading: formData.get("font_heading"),
    font_body: formData.get("font_body"),
    tagline: formData.get("tagline") ?? "",
    about: formData.get("about") ?? "",
    instagram: formData.get("instagram") ?? "",
    facebook: formData.get("facebook") ?? "",
    x: formData.get("x") ?? "",
    tiktok: formData.get("tiktok") ?? "",
    website: formData.get("website") ?? "",
  };

  const result = updateSiteSettingsSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { error: firstIssue?.message ?? "Invalid input." };
  }

  const {
    primary_color,
    secondary_color,
    accent_color,
    font_heading,
    font_body,
    tagline,
    about,
    instagram,
    facebook,
    x,
    tiktok,
    website,
  } = result.data;

  // Build the social object: only include keys where the URL is present.
  const social: Record<string, string> = {};
  if (instagram) social.instagram = instagram;
  if (facebook) social.facebook = facebook;
  if (x) social.x = x;
  if (tiktok) social.tiktok = tiktok;
  if (website) social.website = website;

  // --- Write to database (RLS double-enforces owner-only UPDATE) ---
  const supabase = createClient();

  // Fetch the tenant slug so we can revalidate the public site path.
  const { data: tenantData } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", profile.tenant_id)
    .single();

  const { error: dbError } = await supabase
    .from("site_settings")
    .update({
      primary_color,
      secondary_color,
      accent_color,
      font_heading,
      font_body,
      tagline: tagline ?? null,
      about: about ?? null,
      social,
    })
    .eq("tenant_id", profile.tenant_id);

  if (dbError) {
    return { error: "Failed to save settings. Please try again." };
  }

  // Revalidate the dashboard design page and the public tenant site.
  revalidatePath("/dashboard/design");
  if (tenantData?.slug) {
    revalidatePath(`/t/${tenantData.slug}`);
  }

  return null;
}

// ---------------------------------------------------------------------------
// saveAssetUrl
// ---------------------------------------------------------------------------

/**
 * Server action: persist a freshly uploaded asset URL into site_settings.
 *
 * Validates that:
 *   - kind is 'logo' or 'hero'
 *   - url is https://
 *   - url originates from this project's Supabase storage (tenant-assets bucket)
 *   - url contains /{tenantId}/ so an owner cannot point at another tenant's file
 *
 * The actual file upload is performed client-side directly to Supabase Storage.
 * This action only records the resulting public URL.
 *
 * Returns null on success or { error: string } on failure.
 */
export async function saveAssetUrl(
  kind: "logo" | "hero",
  url: string
): Promise<DashboardActionState> {
  // --- Auth: require restaurant_owner with a tenant ---
  const profile = await getProfile();
  if (!profile) return { error: "You must be signed in." };
  if (profile.role !== "restaurant_owner") {
    return { error: "Only the owner can upload assets." };
  }
  if (!profile.tenant_id) {
    return { error: "Your account is not associated with a restaurant." };
  }

  // --- Validate kind ---
  if (kind !== "logo" && kind !== "hero") {
    return { error: "Invalid asset kind." };
  }

  // --- Validate URL: must be https ---
  if (!url.startsWith("https://")) {
    return { error: "Asset URL must use the https:// protocol." };
  }

  // --- Validate URL: must come from this project's Supabase storage ---
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const storagePrefix = `${supabaseUrl}/storage/v1/object/public/tenant-assets/`;
  if (!url.startsWith(storagePrefix)) {
    return {
      error: "Asset URL must point to this project's tenant-assets storage.",
    };
  }

  // --- Validate URL: must contain /{tenantId}/ to confirm ownership ---
  if (!url.includes(`/${profile.tenant_id}/`)) {
    return { error: "Asset URL does not belong to your tenant folder." };
  }

  // --- Write to database ---
  const column = kind === "logo" ? "logo_url" : "hero_image_url";
  const supabase = createClient();

  const { error: dbError } = await supabase
    .from("site_settings")
    .update({ [column]: url })
    .eq("tenant_id", profile.tenant_id);

  if (dbError) {
    return { error: "Failed to save asset URL. Please try again." };
  }

  revalidatePath("/dashboard/design");

  return null;
}
