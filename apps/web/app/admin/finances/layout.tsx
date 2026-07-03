"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const TABS = [
  { href: "/admin/finances", label: "Vue d'ensemble", exact: true },
  { href: "/admin/finances/tresorerie", label: "Trésorerie" },
  { href: "/admin/finances/ecritures", label: "Écritures" },
  { href: "/admin/finances/comptes", label: "Comptes & états" },
  { href: "/admin/finances/bilans", label: "Bilans" },
  { href: "/admin/finances/fournisseurs", label: "Fournisseurs & charges" },
];

export default function FinancesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
