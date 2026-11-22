import { execFileSync } from "node:child_process";
import { assertDisposableDatabase } from "./db-guard";

/**
 * Bring the dedicated test database up to the latest migration (non-destructive `migrate deploy`).
 * Each test file then clears tenant data itself (tests/helpers.ts → resetDb), guarded to test databases.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://realy:realy@localhost:5432/realy_test";
  assertDisposableDatabase(url, ["_test"], "Integration tests");
  // Prisma (CLI, config, schema and migrations) lives in packages/database, not at the repo root.
  execFileSync("pnpm", ["--filter", "@realy/database", "exec", "prisma", "migrate", "deploy"], {
    stdio: "pipe",
    // prisma.config.ts prefers DIRECT_DATABASE_URL, so pin both to the guarded test database.
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
  });
}
