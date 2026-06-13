"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveEventImage } from "@/lib/event-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EventImageUploaderProps {
  tenantId: string;
  eventId: string;
  currentImageUrl: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventImageUploader({
  tenantId,
  eventId,
  currentImageUrl,
}: EventImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Файл слишком большой. Максимальный размер - 5 МБ.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    // Storage path: {tenantId}/events/event-{eventId}-{ts}.{ext}
    const path = `${tenantId}/events/event-${eventId}-${Date.now()}.${ext}`;

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

      const result = await saveEventImage(eventId, publicUrl);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setPreviewUrl(publicUrl);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-2">
      {/* Thumbnail */}
      {previewUrl ? (
        <div className="relative overflow-hidden rounded border border-white/10 bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Изображение события"
            className="h-24 w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded border border-dashed border-white/15 bg-white/5">
          <span className="text-xs text-slate-500 text-center px-2">
            Изображение не загружено
          </span>
        </div>
      )}

      {/* Upload control */}
      <label
        className={[
          "btn-secondary cursor-pointer inline-flex",
          isPending ? "pointer-events-none opacity-50" : "",
        ].join(" ")}
      >
        {isPending ? "Загрузка…" : previewUrl ? "Заменить изображение" : "Загрузить изображение"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFileChange}
          disabled={isPending}
        />
      </label>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </div>
  );
}
