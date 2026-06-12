"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveFloorPlanImage } from "@/lib/floor-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — floor plans can be large

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
      setError("File is too large. Maximum size is 10 MB.");
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
        setError(`Upload failed: ${storageError.message}`);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError("Configuration error: NEXT_PUBLIC_SUPABASE_URL is not set.");
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
        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Floor plan background"
            className="h-32 w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
          <span className="text-xs text-gray-400">
            No background photo uploaded
          </span>
        </div>
      )}

      {/* Upload control */}
      <div className="flex items-center gap-3">
        <label
          className={[
            "cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50",
            isPending ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          {isPending ? "Uploading…" : previewUrl ? "Replace photo" : "Upload photo"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
        <span className="text-xs text-gray-400">Max 10 MB. PNG, JPG, WebP.</span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
