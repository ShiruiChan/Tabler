"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateTenantStatus,
  setTenantModule,
  setModulePriceOverride,
} from "@/lib/admin-actions";
import type { TenantStatus, TenantModulePricing } from "@/lib/types/database";
import { PanelCard } from "@/components/ui";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Status control
// ---------------------------------------------------------------------------

function StatusControl({
  tenantId,
  currentStatus,
}: {
  tenantId: string;
  currentStatus: TenantStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value as TenantStatus;
    setError(null);
    startTransition(async () => {
      const result = await updateTenantStatus(tenantId, newStatus);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <select
        defaultValue={currentStatus}
        onChange={handleChange}
        disabled={isPending}
        className="select-dark w-auto disabled:opacity-50"
      >
        <option value="active">активен</option>
        <option value="suspended">приостановлен</option>
        <option value="pending">ожидает</option>
      </select>
      {isPending && <span className="text-sm text-slate-400">Сохранение…</span>}
      {error && <span className="text-sm text-rose-400">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module row
// ---------------------------------------------------------------------------

function ModuleRow({
  tenantId,
  module,
  moduleName,
}: {
  tenantId: string;
  module: TenantModulePricing;
  moduleName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [overrideInput, setOverrideInput] = useState(
    module.price_override_cents !== null
      ? (module.price_override_cents / 100).toFixed(2)
      : ""
  );

  function handleToggle(e: React.ChangeEvent<HTMLInputElement>) {
    const enabled = e.target.checked;
    setToggleError(null);
    startTransition(async () => {
      const result = await setTenantModule(tenantId, module.module_id, enabled);
      if (result?.error) {
        setToggleError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handlePriceSave() {
    setPriceError(null);
    const trimmed = overrideInput.trim();

    let priceCents: number | null;

    if (trimmed === "") {
      // Empty input → clear override
      priceCents = null;
    } else {
      const parsed = parseFloat(trimmed);
      if (isNaN(parsed) || parsed < 0) {
        setPriceError("Введите корректную сумму (например, 9.99) или оставьте поле пустым для базовой цены.");
        return;
      }
      priceCents = Math.round(parsed * 100);
    }

    startTransition(async () => {
      const result = await setModulePriceOverride(
        tenantId,
        module.module_id,
        priceCents
      );
      if (result?.error) {
        setPriceError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <tr className="border-t border-white/5 hover:bg-white/5">
      <td className="px-4 py-3 text-sm font-medium text-slate-200">
        {moduleName}
        <span className="ml-1 font-mono text-xs text-slate-500">
          ({module.module_id})
        </span>
      </td>
      <td className="px-4 py-3">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked={module.enabled}
            onChange={handleToggle}
            disabled={isPending}
            className="h-4 w-4 rounded border-white/20 bg-white/5 text-amber-500 accent-amber-500 disabled:opacity-50"
          />
          <span className="text-sm text-slate-400">
            {module.enabled ? "Включён" : "Отключён"}
          </span>
        </label>
        {toggleError && (
          <p className="mt-1 text-xs text-rose-400">{toggleError}</p>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {centsToDisplay(module.base_price_cents)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            placeholder="-"
            disabled={isPending}
            className="input-dark w-24 px-2 py-1 text-sm disabled:opacity-50"
          />
          <button
            onClick={handlePriceSave}
            disabled={isPending}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
          >
            {isPending ? "…" : "Сохранить"}
          </button>
        </div>
        {priceError && (
          <p className="mt-1 text-xs text-rose-400">{priceError}</p>
        )}
        <p className="field-hint">
          Оставьте пустым для базовой цены
        </p>
      </td>
      <td className="px-4 py-3 text-sm font-medium text-slate-200">
        {centsToDisplay(module.effective_price_cents)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function TenantControls({
  tenantId,
  currentStatus,
  modules,
  moduleNameMap,
}: {
  tenantId: string;
  currentStatus: TenantStatus;
  modules: TenantModulePricing[];
  moduleNameMap: Record<string, string>;
}) {
  return (
    <div className="space-y-8">
      {/* Status */}
      <PanelCard title="Статус" description="Управляйте статусом ресторана.">
        <StatusControl tenantId={tenantId} currentStatus={currentStatus} />
      </PanelCard>

      {/* Modules */}
      <PanelCard title="Модули" description="Подключение модулей и индивидуальные цены." className="overflow-hidden">
        {modules.length === 0 ? (
          <p className="text-sm text-slate-400">В каталоге платформы нет модулей.</p>
        ) : (
          <div className="-mx-6 -mb-6 overflow-x-auto border-t border-white/10">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-white/10">
                  {["Модуль", "Включён", "Базовая цена", "Переопределение ($/-)", "Итоговая цена"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <ModuleRow
                    key={m.module_id}
                    tenantId={tenantId}
                    module={m}
                    moduleName={moduleNameMap[m.module_id] ?? m.module_id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  );
}
