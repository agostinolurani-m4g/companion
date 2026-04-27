# HMR Companion — Next.js standalone + better-sqlite3 (glibc)
# Build context: directory hmr-companion/ (repo root of this app).
# Prima del build Docker: `npm ci && npm run seed` così esiste `data/hmr.db` da copiare nell'immagine (opzionale ma consigliato).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
ENV HMR_DB_PATH=/data/hmr.db

RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN mkdir -p /data /app/seed && chown -R nextjs:nodejs /app /data

# Cartella data/ (GPX/PDF da git; hmr.db opzionale dopo `npm run seed` in locale — non committato)
COPY data /tmp/builddata
RUN if [ -f /tmp/builddata/hmr.db ]; then \
      install -o nextjs -g nodejs -m 0644 /tmp/builddata/hmr.db /app/seed/hmr.db; \
    else \
      echo "docker build: data/hmr.db assente — immagine senza seed DB (monta /data o rebuild dopo seed)"; \
    fi \
  && rm -rf /tmp/builddata

COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && chown nextjs:nodejs /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3002

ENTRYPOINT ["/app/docker-entrypoint.sh"]
