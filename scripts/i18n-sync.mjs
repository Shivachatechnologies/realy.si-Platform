/**
 * Message catalogs after the app split (docs/architecture/apps.md §i18n):
 *   apps/user/src/i18n/messages/<locale>.json   source of truth for every product namespace (common, errors, auth, …)
 *   apps/admin/src/i18n/messages/<locale>.json  admin-owned namespaces (admin, and any namespace the user app lacks)
 *                                               + COPIES of the product namespaces the Control Center uses
 *
 *   node scripts/i18n-sync.mjs              refresh the admin copies from apps/user (edit shared strings in apps/user only)
 *   node scripts/i18n-sync.mjs --check      exit 1 if a copy is stale, or any message is invalid ICU (CI)
 *   node scripts/i18n-sync.mjs --add <ns>   start using another product namespace in the admin app
 *
 * Also runs scripts/i18n-namespaces.mjs (client message manifests): rewritten by default, verified with --check.
 */
import fs from "node:fs";
import path from "node:path";
import { findIcuProblems } from "./i18n-icu-check.mjs";

const root = path.join(import.meta.dirname, "..");
const userDir = path.join(root, "apps/user/src/i18n/messages");
const adminDir = path.join(root, "apps/admin/src/i18n/messages");
const args = process.argv.slice(2);
const check = args.includes("--check");
const add = args.includes("--add") ? args[args.indexOf("--add") + 1] : null;

let stale = 0;
for (const file of fs.readdirSync(userDir).filter((f) => f.endsWith(".json")).sort()) {
  const user = JSON.parse(fs.readFileSync(path.join(userDir, file), "utf8"));
  const adminPath = path.join(adminDir, file);
  const admin = fs.existsSync(adminPath) ? JSON.parse(fs.readFileSync(adminPath, "utf8")) : {};
  if (add && !(add in user)) {
    console.error(`i18n-sync: namespace "${add}" does not exist in apps/user/src/i18n/messages/${file}`);
    process.exit(1);
  }
  const next = {};
  for (const [ns, value] of Object.entries(admin)) next[ns] = ns in user ? user[ns] : value;
  if (add && !(add in next)) next[add] = user[add];
  const before = `${JSON.stringify(admin, null, 2)}\n`;
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (before === after) continue;
  stale++;
  if (check) console.error(`i18n-sync: apps/admin/src/i18n/messages/${file} is out of sync with apps/user`);
  else fs.writeFileSync(adminPath, after);
}
if (check && stale) {
  console.error("Run: node scripts/i18n-sync.mjs");
  process.exit(1);
}
if (check) {
  const problems = findIcuProblems();
  for (const p of problems) console.error(`i18n-icu: ${p}`);
  if (problems.length) process.exit(1);
}
console.log(check ? "i18n-sync: admin catalogs in sync." : `i18n-sync: ${stale} admin catalog(s) updated.`);

// Client message manifests (which namespaces each layout sends to the browser): rewritten here, verified with --check.
await import("./i18n-namespaces.mjs");
