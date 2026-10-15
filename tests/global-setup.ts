import { execFileSync } from "node:child_process";
import { assertDisposableDatabase } from "./db-guard";

/**
 * Bring the dedicated test database up to the latest migration (non-destructive `migrate deploy`).
 * Each test file then clears tenant data itself (tests/helpers.ts → resetDb), guarded to test databases.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://realy:realy@localhost:5432/realy_test";
  assertDisposableDatabase(url, ["_test"], "Integration tests");
  execFileSync("pnpm", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
