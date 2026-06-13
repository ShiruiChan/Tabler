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
      setError("Введите корректную сумму (например, 9.99).");
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
        <span className="text-sm text-slate-500">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSaved(false);
          }}
          disabled={isPending}
          className="input-dark w-24 px-2 py-1 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSave}
          disabled={isPending}
          className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
        >
          {isPending ? "…" : "Сохранить"}
        </button>
        {saved && !isPending && (
          <span className="text-xs text-emerald-400">Сохранено</span>
        )}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
