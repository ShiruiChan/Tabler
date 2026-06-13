import "server-only";

import { SITE_FONTS, type SiteFont, type SiteSettings } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Defaults - mirrors the DB column defaults from 0003_site_settings.sql.
// Used when a tenant row exists but has no site_settings row yet.
// ---------------------------------------------------------------------------

export const DEFAULT_THEME = {
  primary_color: "#1a1a1a",
  secondary_color: "#f5f5f5",
  accent_color: "#e11d48",
  font_heading: "Inter" as SiteFont,
  font_body: "Inter" as SiteFont,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Regex that matches a valid 6-digit CSS hex colour (#rrggbb). */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Validate a colour value from the DB against a strict hex pattern.
 * Falls back to the provided default on any mismatch.
 * This guards against DB drift and, critically, prevents url()/expression()
 * payloads in style objects even though React already escapes attribute
 * strings - belt and suspenders.
 */
function safeColor(value: string, fallback: string): string {
  return HEX_RE.test(value) ? value : fallback;
}

/**
 * Validate a font family value from the DB against the SITE_FONTS allowlist.
 * Falls back to Inter on any mismatch.
 */
function safeFont(value: string, fallback: SiteFont = "Inter"): SiteFont {
  return (SITE_FONTS as readonly string[]).includes(value)
    ? (value as SiteFont)
    : fallback;
}

/**
 * Return the CSS font-family stack for a given SiteFont.
 * All seven fonts are served from Google Fonts, so the generic fallback is the
 * only offline safety net.
 */
function fontStack(font: SiteFont): string {
  // Serif fonts get a serif generic; everything else gets sans-serif.
  const serifFonts: SiteFont[] = ["Lora", "Playfair Display", "Merriweather"];
  const generic = serifFonts.includes(font) ? "serif" : "sans-serif";
  // Wrap the family name in quotes if it contains spaces.
  const familyName = font.includes(" ") ? `'${font}'` : font;
  return `${familyName}, ${generic}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The CSS custom-property style object applied to the tenant wrapper div.
 * Using React.CSSProperties is not quite right here because CSS custom
 * properties are not part of that type; we use a plain Record instead and
 * cast at the call site.
 */
export type ThemeStyle = Record<string, string>;

/**
 * Build a CSS custom-property style object from a SiteSettings row.
 *
 * All values are sanitised:
 *   - Colours are validated against `#rrggbb` - bad values fall back to
 *     DEFAULT_THEME equivalents.
 *   - Fonts are validated against SITE_FONTS - bad values fall back to Inter.
 *
 * @param settings - A SiteSettings row, or null (no row yet for this tenant).
 * @returns         An object suitable for `<div style={...}>`.
 */
export function buildThemeStyle(settings: SiteSettings | null): ThemeStyle {
  const primary = safeColor(
    settings?.primary_color ?? DEFAULT_THEME.primary_color,
    DEFAULT_THEME.primary_color,
  );
  const secondary = safeColor(
    settings?.secondary_color ?? DEFAULT_THEME.secondary_color,
    DEFAULT_THEME.secondary_color,
  );
  const accent = safeColor(
    settings?.accent_color ?? DEFAULT_THEME.accent_color,
    DEFAULT_THEME.accent_color,
  );
  const headingFont = safeFont(
    settings?.font_heading ?? DEFAULT_THEME.font_heading,
    DEFAULT_THEME.font_heading,
  );
  const bodyFont = safeFont(
    settings?.font_body ?? DEFAULT_THEME.font_body,
    DEFAULT_THEME.font_body,
  );

  return {
    "--color-primary": primary,
    "--color-secondary": secondary,
    "--color-accent": accent,
    "--font-heading": fontStack(headingFont),
    "--font-body": fontStack(bodyFont),
  };
}

/**
 * Build a Google Fonts CSS2 `?family=` URL for the heading and body fonts
 * defined in `settings`.
 *
 * Rules:
 *   - Deduplicates: if heading === body only one `family=` param is emitted.
 *   - Spaces in family names are encoded as `+` (required by the css2 API).
 *   - All seven SITE_FONTS are Google Fonts; none are skipped.
 *   - `display=swap` is always appended.
 *   - Returns null only if both fonts are invalid (should not happen because
 *     safeFont falls back to Inter, which is always valid).
 *
 * @param settings - A SiteSettings row, or null.
 * @returns         A Google Fonts stylesheet URL, or null.
 */
export function googleFontsUrl(settings: SiteSettings | null): string | null {
  const headingFont = safeFont(
    settings?.font_heading ?? DEFAULT_THEME.font_heading,
    DEFAULT_THEME.font_heading,
  );
  const bodyFont = safeFont(
    settings?.font_body ?? DEFAULT_THEME.font_body,
    DEFAULT_THEME.font_body,
  );

  // Deduplicate while preserving order (heading first).
  const seen = new Set<string>();
  const families: string[] = [];
  for (const font of [headingFont, bodyFont]) {
    if (!seen.has(font)) {
      seen.add(font);
      // Google Fonts css2 API encodes spaces as '+'.
      families.push(font.replace(/ /g, "+"));
    }
  }

  if (families.length === 0) return null;

  const params = families.map((f) => `family=${f}`).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
