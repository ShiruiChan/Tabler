"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateSiteSettings } from "@/lib/dashboard-actions";
import type { DashboardActionState } from "@/lib/dashboard-actions";
import { SITE_FONTS } from "@/lib/types/database";
import type { SiteFont } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DesignFormProps {
  initialValues: {
    primary_color: string;
    secondary_color: string;
    accent_color: string;
    font_heading: SiteFont;
    font_body: SiteFont;
    tagline: string;
    about: string;
    instagram: string;
    facebook: string;
    x: string;
    tiktok: string;
    website: string;
  };
}

// ---------------------------------------------------------------------------
// Submit button (needs useFormStatus so it must be its own component)
// ---------------------------------------------------------------------------

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Color input: native color picker + hex text fallback side-by-side
// ---------------------------------------------------------------------------

function ColorInput({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-3">
        {/* Native color picker — updates the hidden text input via JS, but
            both inputs share the same name so the last one wins in FormData.
            We keep them in sync client-side for UX; the text field is the
            authoritative submitted value. */}
        <input
          type="color"
          aria-hidden="true"
          tabIndex={-1}
          defaultValue={defaultValue}
          onChange={(e) => {
            const textInput = e.currentTarget
              .closest(".color-field-group")
              ?.querySelector<HTMLInputElement>("input[type=text]");
            if (textInput) {
              textInput.value = e.target.value;
            }
          }}
          className="color-field-group h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5"
        />
        <input
          id={id}
          name={name}
          type="text"
          defaultValue={defaultValue}
          maxLength={7}
          placeholder="#1a1a1a"
          onChange={(e) => {
            const colorInput = e.currentTarget
              .closest(".color-field-group")
              ?.querySelector<HTMLInputElement>("input[type=color]");
            if (colorInput && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
              colorInput.value = e.target.value;
            }
          }}
          className="block w-28 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-900 focus:outline-none"
        />
        {/* Live swatch */}
        <span
          className="inline-block h-7 w-7 rounded-full border border-gray-200"
          style={{ backgroundColor: defaultValue }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------

const initialState: DashboardActionState = null;

export default function DesignForm({ initialValues }: DesignFormProps) {
  const [state, formAction] = useFormState(updateSiteSettings, initialState);

  return (
    <form action={formAction} className="space-y-8">
      {/* Global error banner */}
      {state?.error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {/* Success banner */}
      {state === null && (
        /* state starts as null, so only show when it was explicitly returned
           null (i.e., a successful save).  On first render before any submit,
           state is also null — so we track via a hidden sentinel in the form
           state: when error is undefined the form hasn't been submitted yet.
           However, useFormState resets to initialState between renders; the
           simplest approach is to omit the success banner on initial load by
           not distinguishing it from unsubmitted state.  Instead, we rely on
           the button label ("Saving…" / "Save settings") for feedback. */
        <></>
      )}

      {/* Colors */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Brand Colors
        </h2>
        <div className="color-field-group space-y-4">
          <ColorInput
            id="primary_color"
            name="primary_color"
            label="Primary color"
            defaultValue={initialValues.primary_color}
          />
          <ColorInput
            id="secondary_color"
            name="secondary_color"
            label="Secondary color"
            defaultValue={initialValues.secondary_color}
          />
          <ColorInput
            id="accent_color"
            name="accent_color"
            label="Accent color"
            defaultValue={initialValues.accent_color}
          />
        </div>
      </section>

      {/* Fonts */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Typography
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="font_heading"
              className="block text-sm font-medium text-gray-700"
            >
              Heading font
            </label>
            <select
              id="font_heading"
              name="font_heading"
              defaultValue={initialValues.font_heading}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            >
              {SITE_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="font_body"
              className="block text-sm font-medium text-gray-700"
            >
              Body font
            </label>
            <select
              id="font_body"
              name="font_body"
              defaultValue={initialValues.font_body}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            >
              {SITE_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Content */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">Content</h2>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="tagline"
              className="block text-sm font-medium text-gray-700"
            >
              Tagline{" "}
              <span className="text-gray-400">(max 200 characters)</span>
            </label>
            <input
              id="tagline"
              name="tagline"
              type="text"
              maxLength={200}
              defaultValue={initialValues.tagline}
              placeholder="Your short catchy tagline"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="about"
              className="block text-sm font-medium text-gray-700"
            >
              About us{" "}
              <span className="text-gray-400">(max 2000 characters)</span>
            </label>
            <textarea
              id="about"
              name="about"
              rows={6}
              maxLength={2000}
              defaultValue={initialValues.about}
              placeholder="Tell visitors about your restaurant…"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Social links */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Social Links
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Enter full URLs with https:// (e.g.{" "}
          <span className="font-mono">
            https://instagram.com/yourrestaurant
          </span>
          ). Leave blank to remove.
        </p>
        <div className="space-y-4">
          {(
            [
              { id: "instagram", label: "Instagram" },
              { id: "facebook", label: "Facebook" },
              { id: "x", label: "X (Twitter)" },
              { id: "tiktok", label: "TikTok" },
              { id: "website", label: "Website" },
            ] as const
          ).map(({ id, label }) => (
            <div key={id}>
              <label
                htmlFor={id}
                className="block text-sm font-medium text-gray-700"
              >
                {label}
              </label>
              <input
                id={id}
                name={id}
                type="url"
                defaultValue={
                  initialValues[id as keyof typeof initialValues] as string
                }
                placeholder="https://"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </section>

      <SubmitButton />
    </form>
  );
}
