"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateTenant } from "@/lib/admin-actions";
import type { AdminActionState } from "@/lib/admin-actions";
import type { Tenant } from "@/lib/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

const initialState: AdminActionState = null;

export default function UpdateTenantForm({ tenant }: { tenant: Tenant }) {
  const [state, formAction] = useFormState(updateTenant, initialState);

  return (
    <form
      action={formAction}
      className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-6"
    >
      <input type="hidden" name="tenant_id" value={tenant.id} />

      {state?.error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={tenant.name}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="custom_domain"
          className="block text-sm font-medium text-gray-700"
        >
          Custom domain <span className="text-gray-400">(optional)</span>
        </label>
        <input
          id="custom_domain"
          name="custom_domain"
          type="text"
          defaultValue={tenant.custom_domain ?? ""}
          placeholder="www.myrestaurant.com"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
