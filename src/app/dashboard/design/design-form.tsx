"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateSiteSettings } from "@/lib/dashboard-actions";
import type { DashboardActionState } from "@/lib/dashboard-actions";
import { SITE_FONTS } from "@/lib/types/database";
import type { SiteFont } from "@/lib/types/database";
import { PanelCard } from "@/components/ui";

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
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Сохранение…" : "Сохранить настройки"}
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
      <label htmlFor={id} className="label-dark">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {/* Native color picker - updates the hidden text input via JS, but
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
          className="color-field-group h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-white/5 p-1"
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
          className="input-dark w-28 font-mono"
        />
        {/* Live swatch */}
        <span
          className="inline-block h-7 w-7 rounded-full border border-white/15"
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
        <div role="alert" className="alert-error">
          {state.error}
        </div>
      )}

      {/* Success banner */}
      {state === null && (
        /* state starts as null, so only show when it was explicitly returned
           null (i.e., a successful save).  On first render before any submit,
           state is also null - so we track via a hidden sentinel in the form
           state: when error is undefined the form hasn't been submitted yet.
           However, useFormState resets to initialState between renders; the
           simplest approach is to omit the success banner on initial load by
           not distinguishing it from unsubmitted state.  Instead, we rely on
           the button label ("Saving…" / "Save settings") for feedback. */
        <></>
      )}

      {/* Colors */}
      <PanelCard title="Цвета бренда">
        <div className="color-field-group space-y-4">
          <ColorInput
            id="primary_color"
            name="primary_color"
            label="Основной цвет"
            defaultValue={initialValues.primary_color}
          />
          <ColorInput
            id="secondary_color"
            name="secondary_color"
            label="Вторичный цвет"
            defaultValue={initialValues.secondary_color}
          />
          <ColorInput
            id="accent_color"
            name="accent_color"
            label="Акцентный цвет"
            defaultValue={initialValues.accent_color}
          />
        </div>
      </PanelCard>

      {/* Fonts */}
      <PanelCard title="Типографика">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="font_heading" className="label-dark">
              Шрифт заголовков
            </label>
            <select
              id="font_heading"
              name="font_heading"
              defaultValue={initialValues.font_heading}
              className="select-dark"
            >
              {SITE_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="font_body" className="label-dark">
              Шрифт текста
            </label>
            <select
              id="font_body"
              name="font_body"
              defaultValue={initialValues.font_body}
              className="select-dark"
            >
              {SITE_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PanelCard>

      {/* Content */}
      <PanelCard title="Содержание">
        <div className="space-y-4">
          <div>
            <label htmlFor="tagline" className="label-dark">
              Слоган <span className="text-slate-500">(до 200 символов)</span>
            </label>
            <input
              id="tagline"
              name="tagline"
              type="text"
              maxLength={200}
              defaultValue={initialValues.tagline}
              placeholder="Короткий запоминающийся слоган"
              className="input-dark"
            />
          </div>
          <div>
            <label htmlFor="about" className="label-dark">
              О нас <span className="text-slate-500">(до 2000 символов)</span>
            </label>
            <textarea
              id="about"
              name="about"
              rows={6}
              maxLength={2000}
              defaultValue={initialValues.about}
              placeholder="Расскажите гостям о вашем ресторане…"
              className="input-dark"
            />
          </div>
        </div>
      </PanelCard>

      {/* Social links */}
      <PanelCard title="Ссылки на соцсети">
        <p className="field-hint mb-4 mt-0">
          Указывайте полные URL с https:// (например,{" "}
          <span className="font-mono">
            https://instagram.com/yourrestaurant
          </span>
          ). Оставьте поле пустым, чтобы удалить ссылку.
        </p>
        <div className="space-y-4">
          {(
            [
              { id: "instagram", label: "Instagram" },
              { id: "facebook", label: "Facebook" },
              { id: "x", label: "X (Twitter)" },
              { id: "tiktok", label: "TikTok" },
              { id: "website", label: "Сайт" },
            ] as const
          ).map(({ id, label }) => (
            <div key={id}>
              <label htmlFor={id} className="label-dark">
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
                className="input-dark"
              />
            </div>
          ))}
        </div>
      </PanelCard>

      <SubmitButton />
    </form>
  );
}
