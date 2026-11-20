#!/usr/bin/env node
/**
 * App isolation check (docs/architecture/apps.md), run in CI as `pnpm check:boundaries`:
 * resolves every import of apps/* and packages/* through each project's tsconfig aliases and fails when
 *   - apps/user reaches apps/admin (or the admin API-client entry), or apps/admin reaches apps/user;
 *   - a package imports an app (`@/components/…`, `@/app/…`, apps/…);
 *   - an import does not resolve inside the importing project's view (code living on the other side).
 * Node built-ins only. Exit 1 with the list of violations.
 */
import fs from "node:fs";
import path from "node:path";
import { walk, checkBoundaries, CODE_EXT } from "./lib.mjs";
import { ALIASES } from "./config.mjs";

const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "apps")) || !fs.existsSync(path.join(ROOT, "packages"))) {
  console.error("check-boundaries: run from the monorepo root (apps/ and packages/ not found).");
  process.exit(1);
}
const files = new Map();
for (const p of [...walk(ROOT, "apps"), ...walk(ROOT, "packages")]) {
  if (p.startsWith("packages/database/src/generated/")) continue;
  files.set(p, CODE_EXT.test(p) ? fs.readFileSync(path.join(ROOT, p), "utf8") : null);
}
const errors = checkBoundaries(files, ALIASES);
if (errors.length) {
  console.error(`check-boundaries: ${errors.length} violation(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`check-boundaries: OK (${files.size} files in apps/ and packages/).`);
