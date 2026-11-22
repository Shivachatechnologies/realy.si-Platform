# Background worker image (Render / Fly / any container host). Run from the repository root:
#   docker build -f deploy/worker/Dockerfile .
# Unlike the root Dockerfile, this never runs `next build`: the worker only needs the workspace sources, the
# installed dependencies and the generated Prisma client (docs/deployment.md "Worker service").
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/user/package.json apps/user/
COPY apps/admin/package.json apps/admin/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @realy/database run generate

FROM base AS worker
ENV NODE_ENV=production REALY_SERVICE=worker PATH=/app/packages/backend/node_modules/.bin:/app/node_modules/.bin:$PATH
RUN useradd --system --uid 1001 realy
COPY --from=build --chown=realy /app /app
USER realy
WORKDIR /app/packages/backend
# Drains running jobs on SIGTERM for WORKER_SHUTDOWN_TIMEOUT_MS.
STOPSIGNAL SIGTERM
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]
