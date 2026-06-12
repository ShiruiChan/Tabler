"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createTenant } from "@/lib/admin-actions";
import type { AdminActionState } from "@/lib/admin-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create tenant"}
    </button>
  );
}

const initialState: AdminActionState = null;

export default function NewTenantForm() {
  const [state, formAction] = useFormState(createTenant, initialState);

  return (
    <form
      action={formAction}
      className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-6"
    >
      {state?.error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
          Slug <span className="text-gray-400">(immutable)</span>
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          placeholder="my-restaurant"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="My Restaurant"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="custom_domain" className="block text-sm font-medium text-gray-700">
          Custom domain <span className="text-gray-400">(optional)</span>
        </label>
        <input
          id="custom_domain"
          name="custom_domain"
          type="text"
          placeholder="www.myrestaurant.com"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
