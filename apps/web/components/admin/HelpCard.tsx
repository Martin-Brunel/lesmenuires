"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";

/**
 * Encart pédagogique repliable. Ouvert à la première visite, puis l'état
 * (ouvert/replié) est mémorisé par page dans localStorage — l'aide reste
 * accessible d'un clic sans encombrer les habitués.
 */
export function HelpCard({
  id,
  title = "Comment lire cette page ?",
  children,
}: {
  /** Clé de persistance, unique par page (ex. "ecritures"). */
  id: string;
  title?: string;
  children: ReactNode;
}) {
  const storageKey = `admin-help-${id}`;
  // null tant que localStorage n'est pas lu (SSR) — on rend replié par défaut
  // pour éviter un flash d'ouverture chez ceux qui l'ont fermé.
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    setOpen(saved === null ? true : saved === "open");
  }, [storageKey]);

  const toggle = () => {
    const next = !(open ?? false);
    setOpen(next);
    window.localStorage.setItem(storageKey, next ? "open" : "closed");
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-sky-900 dark:text-sky-200"
      >
        <CircleHelp className="h-4 w-4 shrink-0" />
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3 text-sm text-sky-950/90 dark:text-sky-100/90 [&_b]:font-semibold">
          {children}
        </div>
      )}
    </div>
  );
}
