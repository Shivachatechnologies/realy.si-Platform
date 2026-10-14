import type { NextConfig } from "next";
import { API_CSP, HSTS, STATIC_SECURITY_HEADERS } from "./src/server/core/security-headers";

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Cache Components / Partial Prerendering are disabled on purpose: a nonce-based CSP requires every HTML
  // response to be rendered per request (Next.js docs: PPR static shells cannot carry a nonce).
  cacheComponents: false,
  poweredByHeader: false,
  // Native/server-only packages stay external to the server bundle.
  serverExternalPackages: ["@node-rs/argon2", "pino", "@sentry/node"],
  turbopack: {
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
