"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveFloorPlanImage } from "@/lib/floor-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB - floor plans can be large

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FloorPhotoUploaderProps {
  tenantId: string;
  planId: string;
  currentImageUrl: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FloorPhotoUploader({
  tenantId,
  planId,
  currentImageUrl,
}: FloorPhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Client-side size guard.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Файл слишком большой. Максимальный размер - 10 МБ.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // Derive file extension.
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";

    // Storage path: {tenantId}/floor-plans/plan-{planId}-{ts}.{ext}
    const path = `${tenantId}/floor-plans/plan-${planId}-${Date.now()}.${ext}`;

    startTransition(async () => {
      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from("tenant-assets")
        .upload(path, file, { upsert: true });

      if (storageError) {
        setError(`Ошибка загрузки: ${storageError.message}`);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError("Ошибка конфигурации: переменная NEXT_PUBLIC_SUPABASE_URL не задана.");
        return;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/tenant-assets/${path}`;

      const result = await saveFloorPlanImage(planId, publicUrl);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setPreviewUrl(publicUrl);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-3">
      {/* Preview */}
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Фон схемы зала"
            className="h-32 w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/5">
          <span className="text-xs text-slate-500">
            Фон-подложка не загружена
          </span>
        </div>
      )}

      {/* Upload control */}
      <div className="flex items-center gap-3">
        <label
          className={[
            "btn-secondary cursor-pointer",
            isPending ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          {isPending ? "Загрузка…" : previewUrl ? "Заменить фото" : "Загрузить фото"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
        <span className="text-xs text-slate-500">До 10 МБ. PNG, JPG, WebP.</span>
      </div>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </div>
  );
}
