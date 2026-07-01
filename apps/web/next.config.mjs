/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosting friendly: produces a minimal standalone server bundle.
  output: "standalone",
  reactStrictMode: true,
  // Ne pas divulguer la stack.
  poweredByHeader: false,

  // En-têtes de sécurité appliqués à toutes les réponses du front.
  // (HSTS est posé par Caddy en amont ; ici on couvre le reste.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
