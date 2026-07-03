// Mesure d'audience (Umami self-hosted, optionnelle).
//
// Le script est injecté dans app/layout.tsx uniquement si
// NEXT_PUBLIC_ANALYTICS_SRC + NEXT_PUBLIC_ANALYTICS_WEBSITE_ID sont définis au
// build (voir DEPLOY.md « Mesure d'audience »). Sans lui, `track` est un no-op :
// le funnel n'a jamais à savoir si l'analytics est branché.

type UmamiGlobal = {
  track: (event: string, data?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    umami?: UmamiGlobal;
  }
}

/** Émet un évènement funnel (no-op si l'analytics n'est pas configuré). */
export function track(event: string, data?: Record<string, unknown>) {
  try {
    window.umami?.track(event, data);
  } catch {
    // Jamais bloquant : la mesure ne doit pas pouvoir casser la réservation.
  }
}
