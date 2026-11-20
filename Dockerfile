# One image, two services (docs/architecture.md §2, docs/deployment.md):
#   web:     docker build .                      → docker run IMAGE                    (next start, port 3000)
#   worker:  docker build --target worker .      → docker run IMAGE                    (tsx src/worker/index.ts)
#            or the web image with a command override: node_modules/.bin/tsx src/worker/index.ts
#   migrate: docker run IMAGE node_modules/.bin/prisma migrate deploy                  (release step, before web/worker)
# The runtime calls binaries directly: pnpm (via corepack) would need a writable home and network access
# to download itself at container start.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS app
# node_modules/.bin on PATH, as `pnpm run` provides locally: `prisma db seed` spawns `tsx` by name.
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
RUN useradd --system --uid 1001 realy
COPY --from=build --chown=realy /app /app
USER realy
# Both services shut down gracefully on SIGTERM (the worker drains running jobs for WORKER_SHUTDOWN_TIMEOUT_MS).
STOPSIGNAL SIGTERM

# Background worker service: BullMQ queues, schedules, outbox relay. No HTTP port; liveness = heartbeat
# (platform_heartbeats row + Redis key), reported by GET /api/health/ready on the web service.
FROM app AS worker
ENV REALY_SERVICE=worker
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]

# Web service (default target: keep it last).
FROM app AS runtime
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
