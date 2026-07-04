import { NextResponse, type NextRequest } from "next/server";

// Routage des locales du site public : le français reste sans préfixe
// (URLs historiques inchangées), l'anglais vit sous /en. Le proxy retire
// le préfixe /en (rewrite interne) et transmet la locale au layout via
// l'en-tête x-locale — les pages restent à leur emplacement actuel dans app/.
// /admin, /api et les assets ne sont jamais localisés.

const LOCALE_HEADER = "x-locale";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function englishEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/public-settings`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return true;
    const data = (await res.json()) as { englishEnabled?: boolean };
    return data.englishEnabled !== false;
  } catch {
    return true;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /fr/... → redirection canonique sans préfixe (évite le contenu dupliqué).
  if (pathname === "/fr" || pathname.startsWith("/fr/")) {
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/fr" ? "/" : pathname.slice(3);
    return NextResponse.redirect(url, 308);
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    if (!(await englishEnabled())) {
      const redirect = req.nextUrl.clone();
      redirect.pathname = pathname === "/en" ? "/" : pathname.slice(3);
      return NextResponse.redirect(redirect, 307);
    }
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/en" ? "/" : pathname.slice(3);
    const headers = new Headers(req.headers);
    headers.set(LOCALE_HEADER, "en");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const headers = new Headers(req.headers);
  headers.set(LOCALE_HEADER, "fr");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Tout sauf : back-office, API routes Next, assets Next/statiques et fichiers.
  matcher: ["/((?!admin|api|_next|.*\\..*).*)"],
};
