"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Sidebar navigation link with automatic active-state highlighting.
 * `exact` matches the pathname exactly (use for index routes like /dashboard);
 * otherwise a prefix match highlights the link for any nested route.
 */
export function NavLink({
  href,
  icon,
  children,
  exact = false,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={`nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </Link>
  );
}
