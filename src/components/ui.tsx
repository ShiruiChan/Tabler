/**
 * Presentational primitives for the Tabler console (auth / dashboard / admin).
 * Server-safe (no hooks). They encode the landing-page aesthetic so every
 * surface stays consistent. Use the CSS component classes from globals.css
 * (.glass, .btn-primary, .input-dark, .badge, …) for anything not covered here.
 */
import type { ReactNode } from "react";

/** Section header: amber eyebrow, large title, optional description + actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Glass card container. `as="section"` etc. via the `className` prop. */
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`glass ${padded ? "p-6" : ""} ${className}`}>{children}</div>;
}

/** Card with a titled header row. */
export function PanelCard({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/** Big-number stat tile with gradient figure. */
export function StatCard({
  stat,
  label,
  sub,
  icon,
}: {
  stat: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="glass glass-hover p-6">
      {icon && <div className="mb-3 text-amber-400">{icon}</div>}
      <p className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-3xl font-bold text-transparent">{stat}</p>
      <p className="mt-1.5 text-sm font-semibold text-slate-200">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Empty-state block for lists with no rows yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-400">{icon}</div>}
      <p className="text-base font-semibold text-slate-100">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

type BadgeTone = "amber" | "emerald" | "rose" | "sky" | "slate";

/** Status pill. */
export function Badge({ tone = "slate", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
