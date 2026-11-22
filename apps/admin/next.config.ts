import path from "node:path";
import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { API_CSP, HSTS, STATIC_SECURITY_HEADERS } from "../../packages/backend/src/server/core/security-headers";

/** Monorepo root: shared packages live in ../../packages (docs/architecture/apps.md). */
const root = path.join(__dirname, "../..");
// Local development keeps one .env at the repo root (apps/admin/.env.local still wins). Vercel sets real env vars.
loadEnv({ path: path.join(root, ".env"), quiet: true });

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Every HTML response is rendered per request: the proxy's nonce CSP and the console gate need it.
  cacheComponents: false,
  poweredByHeader: false,
  // Vercel's 8 GB build machine: Turbopack's native memory plus a full TypeScript pass no longer fit together.
  // Types are checked separately (`pnpm typecheck`, CI) so the build itself skips the type pass; no server source maps.
  // CI and the Docker image build set SKIP_BUILD_TYPECHECK=1 for the same reason (the pass OOMs at a 4 GB heap).
  typescript: { ignoreBuildErrors: process.env.VERCEL === "1" || process.env.SKIP_BUILD_TYPECHECK === "1" },
  experimental: { serverSourceMaps: false },
  // Inlined at build time: selects the admin session cookie in @realy/auth-core (shared backend code).
  env: { REALY_APP: "admin" },
  serverExternalPackages: ["@node-rs/argon2", "pino", "@sentry/node"],
  outputFileTracingRoot: root,
  turbopack: {
    root,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const common = [
      ...STATIC_SECURITY_HEADERS,
      ...(production ? [HSTS] : []),
      // The Control Center is never indexed.
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/:path*", headers: common },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
