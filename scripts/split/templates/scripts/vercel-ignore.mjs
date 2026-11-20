/**
 * Vercel "Ignored Build Step" for one app (apps/<app>/vercel.json → ignoreCommand):
 *   node ../../scripts/vercel-ignore.mjs user|admin
 * Exit 0 = skip the build, exit 1 = build. An app rebuilds only when its own folder, a shared package, the
 * lockfile/workspace config or a deploy script changed since the last deployed commit — so admin-only changes
 * never rebuild the user app and vice versa. Any doubt (first deploy, shallow clone, git error) builds.
 */
import { execFileSync } from "node:child_process";

const app = process.argv[2];
if (app !== "user" && app !== "admin") {
  console.error("usage: node scripts/vercel-ignore.mjs user|admin");
  process.exit(1);
}
const watched = [`apps/${app}/`, "packages/", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "scripts/deploy-db.mjs", "scripts/vercel-ignore.mjs"];
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!previous) {
  console.log(`vercel-ignore(${app}): no previous deployment — building`);
  process.exit(1);
}
try {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const changed = execFileSync("git", ["diff", "--name-only", previous, "HEAD"], { cwd: top, encoding: "utf8" }).split("\n").filter(Boolean);
  const relevant = changed.filter((f) => watched.some((w) => (w.endsWith("/") ? f.startsWith(w) : f === w)));
  if (relevant.length) {
    console.log(`vercel-ignore(${app}): ${relevant.length} relevant change(s), e.g. ${relevant.slice(0, 5).join(", ")} — building`);
    process.exit(1);
  }
  console.log(`vercel-ignore(${app}): no changes for this app since ${previous.slice(0, 7)} — skipping build`);
  process.exit(0);
} catch (e) {
  console.log(`vercel-ignore(${app}): cannot diff against ${previous.slice(0, 7)} (${e.message.split("\n")[0]}) — building`);
  process.exit(1);
}
