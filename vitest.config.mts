import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a real PostgreSQL database (TEST_DATABASE_URL), never the dev or production one.
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://realy:realy@localhost:5432/realy_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
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
