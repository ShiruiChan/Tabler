"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateTenant } from "@/lib/admin-actions";
import type { AdminActionState } from "@/lib/admin-actions";
import type { Tenant } from "@/lib/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
      {pending ? "Сохранение…" : "Сохранить изменения"}
    </button>
  );
}

const initialState: AdminActionState = null;

export default function UpdateTenantForm({ tenant }: { tenant: Tenant }) {
  const [state, formAction] = useFormState(updateTenant, initialState);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <input type="hidden" name="tenant_id" value={tenant.id} />

      {state?.error && (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="label-dark">
          Название
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={tenant.name}
          className="input-dark mt-1"
        />
      </div>

      <div>
        <label htmlFor="custom_domain" className="label-dark">
          Свой домен <span className="text-slate-500">(необязательно)</span>
        </label>
        <input
          id="custom_domain"
          name="custom_domain"
          type="text"
          defaultValue={tenant.custom_domain ?? ""}
          placeholder="www.myrestaurant.com"
          className="input-dark mt-1"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
