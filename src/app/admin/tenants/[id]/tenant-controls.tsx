"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateTenantStatus,
  setTenantModule,
  setModulePriceOverride,
} from "@/lib/admin-actions";
import type { TenantStatus, TenantModulePricing } from "@/lib/types/database";

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
        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:opacity-50"
      >
        <option value="active">active</option>
        <option value="suspended">suspended</option>
        <option value="pending">pending</option>
      </select>
      {isPending && <span className="text-sm text-gray-400">Saving…</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
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
        setPriceError("Enter a valid dollar amount (e.g. 9.99) or leave empty to use base price.");
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
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">
        {moduleName}
        <span className="ml-1 font-mono text-xs text-gray-400">
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
            className="h-4 w-4 rounded border-gray-300 text-gray-900 disabled:opacity-50"
          />
          <span className="text-sm text-gray-600">
            {module.enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
        {toggleError && (
          <p className="mt-1 text-xs text-red-600">{toggleError}</p>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {centsToDisplay(module.base_price_cents)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            placeholder="—"
            disabled={isPending}
            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handlePriceSave}
            disabled={isPending}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isPending ? "…" : "Save"}
          </button>
        </div>
        {priceError && (
          <p className="mt-1 text-xs text-red-600">{priceError}</p>
        )}
        <p className="mt-0.5 text-xs text-gray-400">
          Leave empty to use base price
        </p>
      </td>
      <td className="px-4 py-3 text-sm font-medium text-gray-900">
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
    <div className="space-y-6">
      {/* Status */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Status</h2>
        <StatusControl tenantId={tenantId} currentStatus={currentStatus} />
      </section>

      {/* Modules */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Modules</h2>
        {modules.length === 0 ? (
          <p className="text-sm text-gray-400">No modules in the platform catalog.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {["Module", "Enabled", "Base price", "Override ($/—)", "Effective price"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
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
      </section>
    </div>
  );
}
