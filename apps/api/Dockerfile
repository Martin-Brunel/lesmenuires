# =============================================================================
# API Rust/Axum — image de production multi-stage
# =============================================================================

# --- Stage build -----------------------------------------------------------
FROM rust:1-bookworm AS builder
WORKDIR /app

# Pré-cache des dépendances : on copie d'abord les manifests et un main vide,
# on compile les deps, puis on remplace par les vraies sources. Un changement de
# code ne réinvalide pas la couche de dépendances.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
COPY migrations ./migrations
# `touch` pour forcer la recompilation du binaire (le main.rs factice est plus récent).
RUN touch src/main.rs && cargo build --release \
    && cp target/release/lesmenuires-api /usr/local/bin/api

# --- Stage runtime ---------------------------------------------------------
FROM debian:bookworm-slim AS runtime
# ca-certificates : requis pour les appels HTTPS sortants (Stripe, Resend).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 appuser

WORKDIR /app
COPY --from=builder /usr/local/bin/api /usr/local/bin/api
# Les migrations sont embarquées dans le binaire (sqlx::migrate!), mais on les
# copie aussi pour référence/débogage.
COPY --from=builder /app/migrations /app/migrations

# Dossier média (monté en volume en prod).
RUN mkdir -p /app/media && chown -R appuser:appuser /app
USER appuser

ENV BIND_ADDR=0.0.0.0:8080
ENV MEDIA_DIR=/app/media
EXPOSE 8080

CMD ["api"]
