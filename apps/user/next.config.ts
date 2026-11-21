import path from "node:path";
import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { API_CSP, HSTS, STATIC_SECURITY_HEADERS } from "../../packages/backend/src/server/core/security-headers";

/** Monorepo root: shared packages live in ../../packages (docs/architecture/apps.md). */
const root = path.join(__dirname, "../..");
// Local development keeps one .env at the repo root (apps/user/.env.local still wins). Vercel sets real env vars.
loadEnv({ path: path.join(root, ".env"), quiet: true });

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Cache Components / Partial Prerendering are disabled on purpose: a nonce-based CSP requires every HTML
  // response to be rendered per request (Next.js docs: PPR static shells cannot carry a nonce).
  cacheComponents: false,
  poweredByHeader: false,
  // Vercel's 8 GB build machine: Turbopack's native memory plus a full TypeScript pass no longer fit together.
  // Types are checked separately (`pnpm typecheck`, CI) so the build itself skips the type pass; no server source maps.
  typescript: { ignoreBuildErrors: process.env.VERCEL === "1" },
  experimental: { serverSourceMaps: false },
  // Inlined at build time: selects this app's session cookie in @realy/auth-core (shared backend code).
  env: { REALY_APP: "user" },
  // Native/server-only packages stay external to the server bundle.
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
    const common = [...STATIC_SECURITY_HEADERS, ...(production ? [HSTS] : [])];
    return [
      { source: "/:path*", headers: common },
      // HTML pages get their nonce CSP from src/proxy.ts; API responses get a deny-all CSP here.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
