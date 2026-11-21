import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a real PostgreSQL database (TEST_DATABASE_URL), never the dev or production one.
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://realy:realy@localhost:5432/realy_test";

export default defineConfig({
  resolve: {
    // Same specifiers as the apps (tsconfig "paths"): backend packages, the user app, admin routes by prefix.
    alias: [
      { find: /^server-only$/, replacement: path.resolve(import.meta.dirname, "tests/stubs/server-only.ts") },
      { find: /^@realy\/shared-types\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/shared-types/src/$1") },
      { find: /^@\/app\/api\/v1\/admin\/(.*)$/, replacement: path.resolve(import.meta.dirname, "apps/admin/src/app/api/v1/admin/$1") },
      { find: /^@\/components\/admin\/(.*)$/, replacement: path.resolve(import.meta.dirname, "apps/admin/src/components/admin/$1") },
      { find: /^@realy\/auth-core$/, replacement: path.resolve(import.meta.dirname, "packages/auth-core/src/index.ts") },
      { find: /^@\/i18n\/messages\/(.*)$/, replacement: path.resolve(import.meta.dirname, "apps/user/src/i18n/messages/$1") },
      { find: /^@\/lib\/api-client$/, replacement: path.resolve(import.meta.dirname, "packages/api-client/src/user.ts") },
      { find: /^@\/i18n\/server$/, replacement: path.resolve(import.meta.dirname, "apps/user/src/i18n/server.ts") },
      { find: /^@\/generated\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/database/src/generated/$1") },
      { find: /^@\/server\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/backend/src/server/$1") },
      { find: /^@\/worker\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/backend/src/worker/$1") },
      { find: /^@\/i18n\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/shared-utils/src/i18n/$1") },
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(import.meta.dirname, "packages/shared-utils/src/lib/$1") },
      { find: /^@\/(.*)$/, replacement: path.resolve(import.meta.dirname, "apps/user/src/$1") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDb,
      TEST_DATABASE_URL: testDb,
      // Fixed, test-only key (not a secret).
      REALY_ENCRYPTION_KEY: "cmVhbHktdGVzdC1vbmx5LWtleS0wMTIzNDU2Nzg5YWI=",
      REALY_DEV_RELAX_MFA: "false",
    },
  },
});
