/**
 * Database release step, run by the USER app's build only (apps/user `pnpm build`) on Vercel (VERCEL=1) or when
 * RUN_DB_MIGRATIONS=true — so each release migrates exactly once. The admin app's build never migrates.
 *   1. prisma migrate deploy — applies pending migrations only (all additive; applied ones never re-run)
 *   2. reference-data seed — idempotent upserts (currencies, countries, permissions, system roles, flags);
 *      the illustrative dev pricing catalog is never seeded here.
 * Uses DIRECT_DATABASE_URL when set (a non-pooled URL is recommended for migrations), else DATABASE_URL.
 * Set SKIP_DB_MIGRATIONS=true to build without touching the database.
 */
import { execSync } from "node:child_process";
import path from "node:path";

const enabled = (process.env.VERCEL === "1" || process.env.RUN_DB_MIGRATIONS === "true") && process.env.SKIP_DB_MIGRATIONS !== "true";
if (!enabled) {
  console.log("deploy-db: skipped (not on Vercel; set RUN_DB_MIGRATIONS=true to run)");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("deploy-db: DATABASE_URL is not set for this environment — add it in Vercel → Settings → Environment Variables");
  process.exit(1);
}
// Prisma schema, migrations, seed and config live in packages/database.
const cwd = path.join(import.meta.dirname, "../packages/database");
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, ...env } });
console.log("deploy-db: applying migrations");
run("pnpm exec prisma migrate deploy");
console.log("deploy-db: seeding reference data");
run("pnpm exec tsx prisma/seed.ts", { SEED_DEV_CATALOG: "false" });
console.log("deploy-db: done");
