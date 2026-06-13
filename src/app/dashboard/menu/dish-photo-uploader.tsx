"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveDishPhoto } from "@/lib/menu-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishPhotoUploaderProps {
  tenantId: string;
  dishId: string;
  currentPhotoUrl: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DishPhotoUploader({
  tenantId,
  dishId,
  currentPhotoUrl,
}: DishPhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentPhotoUrl);
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

    // Build the storage path: tenant-assets/{tenantId}/dish-{dishId}-{ts}.{ext}
    const path = `${tenantId}/dish-${dishId}-${Date.now()}.${ext}`;

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

      // Build the public CDN URL.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError("Ошибка конфигурации: переменная NEXT_PUBLIC_SUPABASE_URL не задана.");
        return;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/tenant-assets/${path}`;

      // Persist the URL via server action.
      const result = await saveDishPhoto(dishId, publicUrl);
      if (result?.error) {
        setError(result.error);
        return;
      }

      // Update the thumbnail immediately.
      setPreviewUrl(publicUrl);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-2">
      {/* Thumbnail */}
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Фото блюда"
            className="h-16 w-16 object-cover"
          />
        </div>
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/5">
          <span className="px-1 text-center text-[10px] text-slate-500">
            Нет фото
          </span>
        </div>
      )}

      {/* Upload control */}
      <label
        className={[
          "inline-flex cursor-pointer items-center rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 focus-within:outline-none focus-within:ring-2 focus-within:ring-amber-400",
          isPending ? "pointer-events-none opacity-50" : "",
        ].join(" ")}
      >
        {isPending ? "Загрузка…" : "Загрузить фото"}
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
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
