# =============================================================================
# Web Next.js — image de production (sortie `standalone`)
# =============================================================================

# --- Stage deps ------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage build -----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* est inliné à la compilation → tout ce qui est public (URL de
# l'API, nom du site, identité légale) doit être connu au build (passé en
# build-arg par le docker-compose de prod). Vide = fallback de lib/site.ts.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_SITE_NAME=""
ARG NEXT_PUBLIC_LOCATION=""
ARG NEXT_PUBLIC_CONTACT_EMAIL=""
ARG NEXT_PUBLIC_EDITOR_NAME=""
ARG NEXT_PUBLIC_EDITOR_STATUS=""
ARG NEXT_PUBLIC_EDITOR_ADDRESS=""
ARG NEXT_PUBLIC_EDITOR_SIRET=""
ARG NEXT_PUBLIC_EDITOR_PHONE=""
ARG NEXT_PUBLIC_HOST_NAME=""
ARG NEXT_PUBLIC_HOST_ADDRESS=""
ARG NEXT_PUBLIC_LEGAL_DATE=""
ARG NEXT_PUBLIC_ANALYTICS_SRC=""
ARG NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME \
    NEXT_PUBLIC_LOCATION=$NEXT_PUBLIC_LOCATION \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_EDITOR_NAME=$NEXT_PUBLIC_EDITOR_NAME \
    NEXT_PUBLIC_EDITOR_STATUS=$NEXT_PUBLIC_EDITOR_STATUS \
    NEXT_PUBLIC_EDITOR_ADDRESS=$NEXT_PUBLIC_EDITOR_ADDRESS \
    NEXT_PUBLIC_EDITOR_SIRET=$NEXT_PUBLIC_EDITOR_SIRET \
    NEXT_PUBLIC_EDITOR_PHONE=$NEXT_PUBLIC_EDITOR_PHONE \
    NEXT_PUBLIC_HOST_NAME=$NEXT_PUBLIC_HOST_NAME \
    NEXT_PUBLIC_HOST_ADDRESS=$NEXT_PUBLIC_HOST_ADDRESS \
    NEXT_PUBLIC_LEGAL_DATE=$NEXT_PUBLIC_LEGAL_DATE \
    NEXT_PUBLIC_ANALYTICS_SRC=$NEXT_PUBLIC_ANALYTICS_SRC \
    NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=$NEXT_PUBLIC_ANALYTICS_WEBSITE_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Stage runtime ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN useradd --system --uid 10001 nextjs

# Sortie standalone : serveur minimal + assets statiques + public.
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
