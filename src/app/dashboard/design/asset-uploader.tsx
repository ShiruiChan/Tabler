"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveAssetUrl } from "@/lib/dashboard-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AssetUploaderProps {
  tenantId: string;
  currentLogoUrl: string | null;
  currentHeroUrl: string | null;
}

// ---------------------------------------------------------------------------
// Single-asset uploader sub-component
// ---------------------------------------------------------------------------

function AssetField({
  tenantId,
  kind,
  label,
  currentUrl,
}: {
  tenantId: string;
  kind: "logo" | "hero";
  label: string;
  currentUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Client-side size guard.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Файл слишком большой. Максимальный размер - 5 МБ.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // Derive file extension.
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";

    // Build the storage path: {tenantId}/{kind}-{timestamp}.{ext}
    const path = `${tenantId}/${kind}-${Date.now()}.${ext}`;

    startTransition(async () => {
      // Upload directly from the browser to Supabase Storage.
      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from("tenant-assets")
        .upload(path, file, { upsert: true });

      if (storageError) {
        setError(`Ошибка загрузки: ${storageError.message}`);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      // Build the public CDN URL using NEXT_PUBLIC_SUPABASE_URL (inlined at
      // build time by Next.js - available in client components).
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError("Ошибка конфигурации: переменная NEXT_PUBLIC_SUPABASE_URL не задана.");
        return;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/tenant-assets/${path}`;

      // Persist the URL via server action (validates origin + tenant folder).
      const result = await saveAssetUrl(kind, publicUrl);
      if (result?.error) {
        setError(result.error);
        return;
      }

      // Show the new image immediately.
      setPreviewUrl(publicUrl);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-300">{label}</p>

      {/* Thumbnail */}
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`Превью: ${label}`}
            className={
              kind === "logo"
                ? "h-20 w-auto object-contain p-2"
                : "h-32 w-full object-cover"
            }
          />
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/5">
          <span className="text-xs text-slate-500">Изображение не загружено</span>
        </div>
      )}

      {/* Upload control */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={[
            "btn-secondary cursor-pointer",
            isPending ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          {isPending ? "Загрузка…" : "Выбрать файл"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
        <span className="text-xs text-slate-500">До 5 МБ. PNG, JPG, WebP.</span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function AssetUploader({
  tenantId,
  currentLogoUrl,
  currentHeroUrl,
}: AssetUploaderProps) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      <AssetField
        tenantId={tenantId}
        kind="logo"
        label="Логотип"
        currentUrl={currentLogoUrl}
      />
      <AssetField
        tenantId={tenantId}
        kind="hero"
        label="Обложка (hero)"
        currentUrl={currentHeroUrl}
      />
    </div>
  );
}
