import { execFileSync } from "node:child_process";

/**
 * Bring the dedicated test database up to the latest migration (non-destructive `migrate deploy`).
 * Each test file then clears tenant data itself (tests/helpers.ts → resetDb), guarded to test databases.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://realy:realy@localhost:5432/realy_test";
  if (!/_test(\?|$)/.test(new URL(url).pathname + "?")) throw new Error(`Refusing to use a non-test database: ${url}`);
  execFileSync("pnpm", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
