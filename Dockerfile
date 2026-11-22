# One image per app, two services for the user app (docs/architecture/apps.md, docs/deployment.md):
#   web (user):  docker build .                                   → docker run IMAGE   (next start, port 3000)
#   web (admin): docker build --build-arg APP=admin .             → docker run IMAGE   (next start, port 3000)
#   worker:      docker build --target worker .                   → docker run IMAGE   (tsx src/worker/index.ts in packages/backend)
#   migrate:     docker run -w /app/packages/database IMAGE node_modules/.bin/prisma migrate deploy   (release step, before web/worker)
# The runtime calls binaries directly: pnpm (via corepack) would need a writable home and network access
# to download itself at container start.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/user/package.json apps/user/
COPY apps/admin/package.json apps/admin/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP=user
# Types are a CI gate (`pnpm typecheck`); Next's in-build type pass does not fit the build's 4 GB heap (next.config.ts).
ARG SKIP_BUILD_TYPECHECK=1
ENV SKIP_BUILD_TYPECHECK=${SKIP_BUILD_TYPECHECK}
COPY . .
RUN pnpm --filter @realy/${APP} build

FROM base AS app
ARG APP=user
# Each workspace project's node_modules/.bin on PATH, as `pnpm run` provides locally (`prisma db seed` spawns `tsx`).
ENV NODE_ENV=production APP=${APP} PATH=/app/apps/${APP}/node_modules/.bin:/app/packages/database/node_modules/.bin:/app/packages/backend/node_modules/.bin:/app/node_modules/.bin:$PATH
RUN useradd --system --uid 1001 realy
COPY --from=build --chown=realy /app /app
USER realy
# Both services shut down gracefully on SIGTERM (the worker drains running jobs for WORKER_SHUTDOWN_TIMEOUT_MS).
STOPSIGNAL SIGTERM

# Background worker service: BullMQ queues, schedules, outbox relay. No HTTP port; liveness = heartbeat
# (platform_heartbeats row + Redis key), reported by GET /api/health/ready on the web service.
FROM app AS worker
ENV REALY_SERVICE=worker
WORKDIR /app/packages/backend
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]

# Web service (default target: keep it last).
FROM app AS runtime
ARG APP=user
WORKDIR /app/apps/${APP}
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
