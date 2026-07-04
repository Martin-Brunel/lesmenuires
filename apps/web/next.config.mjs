import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosting friendly: produces a minimal standalone server bundle.
  output: "standalone",
  reactStrictMode: true,
  turbopack: {
    root: appDir,
  },
  // Ne pas divulguer la stack.
  poweredByHeader: false,

  // En-têtes de sécurité appliqués à toutes les réponses du front.
  // (HSTS est posé par Caddy en amont ; ici on couvre le reste.)
  async headers() {
    // Content-Security-Policy : réduit la surface XSS (la description éditoriale
    // est rendue en dangerouslySetInnerHTML). Autorise explicitement Stripe
    // (Payment Element + 3DS) et Google Fonts, bloque le reste.
    // Note : 'unsafe-inline' reste nécessaire côté script (bootstrap Next sans
    // nonce) et style (styles inline de l'app) — la CSP borne malgré tout les
    // origines, les iframes, base-uri et object-src.
    // Origine de l'API (images /media + fetch). En prod = même domaine que le
    // front (Caddy) donc redondant avec 'self' ; en dev = http://localhost:8080.
    let apiOrigin = "";
    try {
      apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "").origin;
    } catch {
      apiOrigin = "";
    }
    // Origine de l'instance Umami (mesure d'audience self-hosted, optionnelle) :
    // le script et ses POST /api/send doivent être autorisés par la CSP.
    let analyticsOrigin = "";
    try {
      analyticsOrigin = new URL(process.env.NEXT_PUBLIC_ANALYTICS_SRC ?? "").origin;
    } catch {
      analyticsOrigin = "";
    }
    // React en mode dev utilise eval() (debugging) ; la prod ne l'utilise jamais.
    // On n'autorise 'unsafe-eval' qu'en développement.
    const devEval = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval} https://js.stripe.com ${analyticsOrigin}`.trim(),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src 'self' data: ${apiOrigin} https://*.stripe.com https://picsum.photos https://*.picsum.photos`,
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      `connect-src 'self' ${apiOrigin} https://api.stripe.com https://*.stripe.com ${analyticsOrigin}`.trim(),
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
