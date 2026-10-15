# One image, two entrypoints (docs/architecture.md §2):
#   web:     docker run IMAGE                                           (next start)
#   worker:  docker run IMAGE node_modules/.bin/tsx src/worker/index.ts
#   migrate: docker run IMAGE node_modules/.bin/prisma migrate deploy   (release step)
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

FROM base AS runtime
ENV NODE_ENV=production
RUN useradd --system --uid 1001 realy
COPY --from=build --chown=realy /app /app
USER realy
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
