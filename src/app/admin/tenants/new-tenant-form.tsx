"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createTenant } from "@/lib/admin-actions";
import type { AdminActionState } from "@/lib/admin-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
      {pending ? "Создание…" : "Создать ресторан"}
    </button>
  );
}

const initialState: AdminActionState = null;

export default function NewTenantForm() {
  const [state, formAction] = useFormState(createTenant, initialState);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {state?.error && (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="slug" className="label-dark">
          Слаг <span className="text-slate-500">(неизменяемый)</span>
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          placeholder="my-restaurant"
          className="input-dark mt-1"
        />
      </div>

      <div>
        <label htmlFor="name" className="label-dark">
          Название
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="My Restaurant"
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
          placeholder="www.myrestaurant.com"
          className="input-dark mt-1"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
