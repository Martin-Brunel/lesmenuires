"use client";

// Contexte i18n du site public. Les deux dictionnaires sont importés ici (côté
// client) : seule la locale traverse la frontière serveur→client, ce qui
// autorise des fonctions d'interpolation dans les dictionnaires.

import { createContext, useContext } from "react";
import {
  DEFAULT_LOCALE,
  getDict,
  localePath,
  type Dict,
  type Locale,
} from "@/lib/i18n";

type I18nValue = {
  locale: Locale;
  englishEnabled: boolean;
  t: Dict;
  /** Préfixe un chemin interne pour la locale courante. */
  href: (path: string) => string;
};

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  englishEnabled: true,
  t: getDict(DEFAULT_LOCALE),
  href: (p) => p,
});

export function I18nProvider({
  locale,
  englishEnabled = true,
  children,
}: {
  locale: Locale;
  englishEnabled?: boolean;
  children: React.ReactNode;
}) {
  const value: I18nValue = {
    locale,
    englishEnabled,
    t: getDict(locale),
    href: (path) => localePath(locale, path),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
