"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signUp } from "@/lib/auth-actions";
import type { AuthActionState } from "@/lib/auth-actions";
import { AuroraBg } from "@/components/aurora-bg";
import { TablerGlyph, IconArrowRight } from "@/components/icons";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Создаём аккаунт…" : "Создать аккаунт"}
      {!pending && <IconArrowRight className="h-4 w-4" />}
    </button>
  );
}

const initialState: AuthActionState = null;

export default function SignupPage() {
  const [state, formAction] = useFormState(signUp, initialState);

  return (
    <main className="console relative flex min-h-screen items-center justify-center px-4 py-12">
      <AuroraBg />

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <TablerGlyph />
          <span className="text-lg font-semibold tracking-tight text-slate-100">Tabler</span>
        </Link>

        <div className="glass animate-fade-up p-8">
          <div className="mb-6 text-center">
            <p className="eyebrow mb-2">Начните бесплатно</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">Создайте ресторан</h1>
            <p className="mt-1.5 text-sm text-slate-400">Одна платформа для меню, брони, событий и доставки.</p>
          </div>

          <form action={formAction} className="space-y-4">
            {state?.error && (
              <p role="alert" className="alert-error">
                {state.error}
              </p>
            )}

            <div>
              <label htmlFor="full_name" className="label-dark">Имя и фамилия</label>
              <input id="full_name" name="full_name" type="text" autoComplete="name" required placeholder="Иван Петров" className="input-dark" />
            </div>

            <div>
              <label htmlFor="email" className="label-dark">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@restaurant.ru" className="input-dark" />
            </div>

            <div>
              <label htmlFor="password" className="label-dark">Пароль</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required placeholder="Минимум 8 символов" className="input-dark" />
            </div>

            <SubmitButton />
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-semibold text-amber-400 hover:text-amber-300">
            Войти
          </Link>
        </p>
      </div>
    </main>
  );
}
