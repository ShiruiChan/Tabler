"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { updateModuleBasePrice } from "@/lib/admin-actions";

export default function ModuleControls({
  moduleId,
  currentBasePriceCents,
}: {
  moduleId: string;
  currentBasePriceCents: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [input, setInput] = useState(
    (currentBasePriceCents / 100).toFixed(2)
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    const parsed = parseFloat(input.trim());
    if (isNaN(parsed) || parsed < 0) {
      setError("Enter a valid dollar amount (e.g. 9.99).");
      return;
    }
    const cents = Math.round(parsed * 100);
    startTransition(async () => {
      const result = await updateModuleBasePrice(moduleId, cents);
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSaved(false);
          }}
          disabled={isPending}
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? "…" : "Save"}
        </button>
        {saved && !isPending && (
          <span className="text-xs text-green-600">Saved</span>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
