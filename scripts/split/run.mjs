#!/usr/bin/env node
/**
 * Realy single-app → two-app split (apps/user + apps/admin + packages/*). See docs/architecture/apps.md.
 *
 *   node scripts/split/run.mjs            # migrate the repository in the current directory
 *   node scripts/split/run.mjs --dry-run  # plan + validate + summary, change nothing
 *
 * Run from the repo root of the CURRENT single-app layout (src/, prisma/). The whole migration is planned and
 * validated in memory first; if any path is unclassified or any import would cross the user/admin boundary, it
 * prints every problem and exits 1 without touching a file. Running it again on a migrated tree is a no-op.
 * Node built-ins only; plain fs moves (commit the result yourself).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  walk, matchGlob, globRest, scanImports, rewriteSpecifiers, isBuiltin, packageName, probe, resolveAlias,
  relativeSpecifier, projectOf, checkBoundaries, CODE_EXT, posix, isAppProvided,
} from "./lib.mjs";
import { ALIASES, RULES, ADMIN_ALSO_SERVES, ADMIN_COPYABLE_COMPONENTS, FIXUPS, PATCHES, SUPERSEDED, ROOT_REMOVED, NEXT_PEERS, I18N, LAYERS } from "./config.mjs";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const TEMPLATES = path.join(import.meta.dirname, "templates");
const abs = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(abs(p));
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const TEXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css|md|mdx|yml|yaml|txt|prisma|sql|toml|html|svg)$|(?:^|\/)(?:Dockerfile|\.gitignore|\.env\.example|\.dockerignore)$/;

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

// ─────────────────────────────── 0. Layout detection (idempotency) ───────────────────────────────
if (exists("apps/user/package.json") && exists("apps/admin/package.json") && !exists("src")) {
  console.log("split: already migrated (apps/user, apps/admin present, no src/). Nothing to do.");
  process.exit(0);
}
if (!exists("src/app") || !exists("package.json")) {
  console.error("split: run this from the repo root of the single-app layout (src/app not found).");
  process.exit(1);
}
for (const d of ["apps", "packages"]) if (exists(d)) fail(`${d}/ already exists next to src/ — a previous run was interrupted? Restore the tree (git checkout/clean) and run again.`);

// ─────────────────────────────── 1. Inputs ───────────────────────────────
const oldFiles = [...walk(ROOT, "src"), ...walk(ROOT, "prisma")];
const oldSet = new Set(oldFiles);
const read = (p) => (TEXT.test(p) ? fs.readFileSync(abs(p), "utf8") : fs.readFileSync(abs(p)));
const rootPkg = JSON.parse(fs.readFileSync(abs("package.json"), "utf8"));
const rootVersions = { ...rootPkg.devDependencies, ...rootPkg.dependencies };

/** Planned output: dest → { content, from?, kind, reroot?, edits? }. */
const out = new Map();
/** Old path → new locations (for relative-import rewriting). */
const oldToNew = new Map();
const consumed = new Set();
const dropped = [];
const addOut = (dest, entry) => {
  if (out.has(dest) && out.get(dest).from !== entry.from) fail(`two sources map to ${dest}: ${out.get(dest).from ?? out.get(dest).kind} and ${entry.from ?? entry.kind}`);
  out.set(dest, entry);
  if (entry.from) oldToNew.set(entry.from, [...(oldToNew.get(entry.from) ?? []).filter((d) => d !== dest), dest]);
};
const destFor = (glob, to, p) => (to.endsWith("**") ? posix(path.join(to.slice(0, -2), globRest(glob, p))) : to);

// ─────────────────────────────── 2. Superseded files must be the versions the templates were written for ───────────────────────────────
for (const [file, expected] of Object.entries(SUPERSEDED)) {
  const [p, field] = file.split("#");
  if (!exists(p)) continue;
  const content = field ? JSON.stringify(JSON.parse(fs.readFileSync(abs(p), "utf8"))[field]) : fs.readFileSync(abs(p), "utf8");
  const actual = sha(content);
  if (expected && actual !== expected)
    fail(`${file} changed since the split templates were written (sha256 ${actual.slice(0, 12)}…). Port the change into scripts/split/templates (see SUPERSEDED in scripts/split/config.mjs), then update its hash.`);
}

// ─────────────────────────────── 3. Classify every file under src/ and prisma/ ───────────────────────────────
const relocated = new Map(FIXUPS.relocate.map((r) => [r.from, r.to]));
const i18nSources = [];
for (const p of oldFiles) {
  if (relocated.has(p)) {
    addOut(relocated.get(p), { from: p, kind: "move" });
    consumed.add(p);
    continue;
  }
  const rule = RULES.find((r) => matchGlob(r.match, p));
  if (!rule) {
    fail(`unclassified path: ${p} (add a rule to RULES in scripts/split/config.mjs)`);
    continue;
  }
  consumed.add(p);
  if (rule.drop) {
    dropped.push(`${p} — ${rule.drop}`);
    continue;
  }
  if (rule.i18n) {
    i18nSources.push(p);
    continue;
  }
  addOut(destFor(rule.match, rule.to, p), { from: p, kind: "move", reroot: !!rule.reroot, css: rule.css });
  for (const extra of rule.also ?? []) addOut(destFor(rule.match, extra.to, p), { from: p, kind: "copy", edits: extra.edits });
}
for (const r of FIXUPS.relocate) if (!oldSet.has(r.from)) warnings.push(`fixup relocate: ${r.from} no longer exists (fixup can be removed)`);
for (const c of ADMIN_ALSO_SERVES)
  for (const p of oldFiles.filter((f) => matchGlob(c.match, f))) addOut(destFor(c.match, c.to, p), { from: p, kind: "copy" });
for (const c of FIXUPS.userCopy) {
  if (!oldSet.has(c.from)) {
    warnings.push(`fixup userCopy: ${c.from} no longer exists`);
    continue;
  }
  addOut(c.to, { from: c.from, kind: "copy" });
}

// ─────────────────────────────── 4. Templates ───────────────────────────────
const supersededTargets = new Set(RULES.flatMap((r) => r.supersededBy ?? []));
const templateFiles = walk(TEMPLATES, "");
for (const t of templateFiles) {
  const content = TEXT.test(t) ? fs.readFileSync(path.join(TEMPLATES, t), "utf8") : fs.readFileSync(path.join(TEMPLATES, t));
  if (out.has(t) && !supersededTargets.has(t)) {
    fail(`template ${t} collides with moved file ${out.get(t).from}`);
    continue;
  }
  out.set(t, { content, kind: "template" });
}

// Load contents of moved/copied files.
for (const e of out.values()) if (e.from) e.content = read(e.from);

// Importers of relocated / user-copied components follow them (in the destination app only).
const alias = (src) => `@/${src.replace(/^(?:apps\/[^/]+\/)?src\//, "").replace(/\.tsx?$/, "")}`;
const specRewrites = [
  ...FIXUPS.relocate.map((r) => ({ project: projectOf(r.to), from: alias(r.from), to: alias(r.to) })),
  ...FIXUPS.userCopy.map((c) => ({ project: "apps/user", from: alias(c.from), to: alias(c.to) })),
];
for (const [dest, e] of out) {
  if (typeof e.content !== "string" || !CODE_EXT.test(dest)) continue;
  const rules = specRewrites.filter((r) => r.project === projectOf(dest));
  if (rules.length) e.content = rewriteSpecifiers(e.content, (s) => rules.find((r) => r.from === s)?.to ?? null);
}

// ─────────────────────────────── 5. Admin copies of shared UI (transitive, only what admin uses) ───────────────────────────────
const oldExists = (p) => oldSet.has(p);
const adminQueue = [...out.keys()].filter((d) => d.startsWith("apps/admin/") && CODE_EXT.test(d));
const adminSeen = new Set();
while (adminQueue.length) {
  const dest = adminQueue.shift();
  if (adminSeen.has(dest)) continue;
  adminSeen.add(dest);
  const entry = out.get(dest);
  if (typeof entry.content !== "string") continue;
  for (const { spec } of scanImports(entry.content)) {
    let oldTarget = null;
    if (spec.startsWith("@/components/")) {
      const own = probe(`apps/admin/src/${spec.slice(2)}`, (p) => out.has(p));
      if (own) {
        adminQueue.push(own);
        continue;
      }
      oldTarget = probe(`src/${spec.slice(2)}`, oldExists);
    } else if (spec.startsWith(".") && entry.from?.startsWith("src/components/")) {
      const candidate = posix(path.normalize(path.join(path.dirname(dest), spec)));
      if (probe(candidate, (p) => out.has(p))) continue;
      oldTarget = probe(posix(path.normalize(path.join(path.dirname(entry.from), spec))), oldExists);
    } else continue;
    if (!oldTarget) continue; // reported by validation
    if (oldTarget.startsWith("src/components/admin/")) continue;
    if (!ADMIN_COPYABLE_COMPONENTS.some((g) => matchGlob(g, oldTarget))) {
      fail(`admin code imports a user component: ${entry.from ?? dest} → ${oldTarget}. Move it under src/components/admin, make it shared UI (ADMIN_COPYABLE_COMPONENTS) or add an admin template.`);
      continue;
    }
    const copy = `apps/admin/${oldTarget}`;
    if (!out.has(copy)) {
      addOut(copy, { from: oldTarget, kind: "copy", content: read(oldTarget), adminShared: true });
      adminQueue.push(copy);
    }
  }
}

// ─────────────────────────────── 6. Code transforms ───────────────────────────────
const isCode = (p) => CODE_EXT.test(p);

/** Express `target` (repo path) as an alias specifier of `project`, if any alias maps to it. */
function aliasFor(project, target) {
  const bare = target.replace(/\.(tsx?|mts)$/, "").replace(/\/index$/, "");
  let best = null;
  for (const [pattern, to] of ALIASES[project] ?? []) {
    if (!to.includes("*")) {
      if (to === target) return pattern;
      continue;
    }
    const prefix = to.slice(0, to.indexOf("*"));
    if (bare.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, pattern };
  }
  if (!best) return null;
  const rest = (target.endsWith(".json") ? target : bare).slice(best.prefix.length);
  return best.pattern.replace("*", rest);
}

/** Rewrite relative imports of a moved file so they point at the new location of their old target. */
function rewriteRelative(dest, from, content) {
  const project = projectOf(dest);
  return rewriteSpecifiers(content, (spec) => {
    if (!spec.startsWith(".")) return null;
    const oldTarget = probe(posix(path.normalize(path.join(path.dirname(from), spec))), (p) => oldSet.has(p) || exists(p));
    if (!oldTarget) return null;
    const keepExt = /\.[a-z]+$/i.test(spec) && !/\.(tsx?|mts)$/.test(spec);
    const fmt = (t) => {
      const rel = relativeSpecifier(dest, t);
      return keepExt ? posix(path.relative(path.dirname(dest), t)).replace(/^(?!\.)/, "./") : rel;
    };
    const targets = oldToNew.get(oldTarget) ?? (i18nSources.includes(oldTarget) ? Object.entries(I18N.outputs).map(([, dir]) => `${dir}/${path.basename(oldTarget)}`) : null);
    if (!targets) return oldSet.has(oldTarget) ? null : fmt(oldTarget); // root file that stays
    const same = targets.find((t) => projectOf(t) === project);
    // Unchanged relative position (moved together): keep the specifier exactly as written.
    if (same && probe(posix(path.normalize(path.join(path.dirname(dest), spec))), (p) => out.has(p)) === same) return null;
    if (same) return fmt(same);
    if (project === "root") return fmt(targets.find((t) => t.startsWith("apps/user/")) ?? targets[0]);
    for (const t of targets) {
      const alias = aliasFor(project, t);
      if (alias) return alias;
    }
    fail(`${dest}: relative import "${spec}" now crosses into ${projectOf(targets[0])} and no alias of ${project} reaches it`);
    return null;
  });
}

/** Admin URL space re-rooted: /[locale]/admin/… → /[locale]/…, "admin/login" → "login". */
function reroot(content) {
  return content
    .replace(/(\/\[locale\])\/admin(?=[/"'`?#)]|$)/g, "$1")
    .replace(/(\$\{[A-Za-z_][\w.]*\})\/admin(?=[/"'`?#)]|$)/g, "$1")
    .replace(/(["'`])admin\/login\1/g, "$1login$1");
}

const messageMoveRes = FIXUPS.messageMoves.map((m) => [new RegExp(`(["'\`])${m.from.replace(/\./g, "\\.")}(?=[.'"\`])`, "g"), `$1${m.to}`]);

for (const [dest, e] of out) {
  if (typeof e.content !== "string" || !isCode(dest)) continue;
  let c = e.content;
  if (e.from) c = rewriteRelative(dest, e.from, c);
  if (e.reroot) c = reroot(c);
  for (const [re, to] of messageMoveRes) c = c.replace(re, to);
  for (const [a, b] of e.edits ?? []) {
    if (!c.includes(a) && !c.includes(b)) warnings.push(`${dest}: edit "${a}" → "${b}" did not apply`);
    c = c.split(a).join(b);
  }
  e.content = c;
}

// Residual admin-prefixed URLs in the admin app (re-rooting missed a pattern).
for (const [dest, e] of out) {
  if (!dest.startsWith("apps/admin/src/") || typeof e.content !== "string" || !isCode(dest) || !e.reroot) continue;
  e.content.split("\n").forEach((line, i) => {
    if (/^\s*(\*|\/\/)/.test(line)) return;
    if (/[`"'/]admin\/(?!api)|\$\{[^}]+\}\/admin\b|["'`]\/admin["'`]/.test(line.replace(/\/api\/v1\/admin\b/g, "").replace(/@\/(server|components)\/[^"']*/g, "")))
      fail(`${dest}:${i + 1}: admin path still carries the /admin prefix: ${line.trim()}`);
  });
}

// ─────────────────────────────── 7. Backend → user-component type imports become shared types ───────────────────────────────
/**
 * Top-level `export interface|type|const` declarations of a module (with their JSDoc). Consts are included so a type
 * derived from a literal tuple (`type X = (typeof XS)[number]`) can move together with it.
 */
function extractTypeDecls(src) {
  const decls = new Map();
  const re = /(^|\n)((?:\/\*\*(?:(?!\*\/)[\s\S])*\*\/\n)?)export (interface|type|const) (\w+)/g;
  for (const m of src.matchAll(re)) {
    // A const keeps its JSDoc in place (it usually documents the module / component, not the tuple).
    const start = m.index + m[1].length + (m[3] === "const" ? m[2].length : 0);
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        i = src.indexOf(ch, i + 1);
        if (i < 0) break;
      } else if (ch === "=" && src[i + 1] === ">") i++;
      else if ("{([<".includes(ch)) depth++;
      else if ("})]>".includes(ch)) {
        depth--;
        if (m[3] === "interface" && depth === 0 && ch === "}") {
          end = i + 1;
          break;
        }
      } else if (ch === ";" && depth === 0 && m[3] !== "interface") {
        end = i + 1;
        break;
      }
    }
    if (end > 0) decls.set(m[4], { start, end, kind: m[3], text: src.slice(start, end) });
  }
  return decls;
}
const topLevelNames = (src) => new Set([...src.matchAll(/(?:^|\n)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g)].map((m) => m[1]));
for (const [dest, e] of out) {
  if (!dest.startsWith("packages/") || typeof e.content !== "string" || !isCode(dest)) continue;
  for (const imp of scanImports(e.content).filter((i) => i.spec.startsWith("@/components/"))) {
    if (!imp.typeOnly) {
      fail(`${dest}: backend imports UI code "${imp.spec}" — move the shared logic into packages/backend`);
      continue;
    }
    const compDest = probe(`apps/user/src/${imp.spec.slice(2)}`, (p) => out.has(p));
    if (!compDest) {
      fail(`${dest}: type import "${imp.spec}" not found in the user app`);
      continue;
    }
    const names = /\{([^}]*)\}/.exec(imp.statement)?.[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean) ?? [];
    const comp = out.get(compDest);
    const decls = extractTypeDecls(comp.content);
    const locals = topLevelNames(comp.content);
    const imported = new Set(scanImports(comp.content).flatMap((i) => (/\{([^}]*)\}/.exec(i.statement)?.[1] ?? "").split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop())).filter(Boolean));
    const closure = new Set();
    let movable = true;
    const visit = (n) => {
      if (closure.has(n)) return;
      if (!decls.has(n)) {
        movable = false;
        return fail(`${dest}: ${n} (imported from ${imp.spec}) is not a top-level export of ${compDest} that can move to packages/shared-types`);
      }
      closure.add(n);
      const code = decls.get(n).text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
      for (const ref of code.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        if (imported.has(ref[1])) {
          movable = false;
          fail(`${dest}: type ${n} of ${compDest} uses the imported ${ref[1]} — move the type into packages/shared-types by hand`);
          continue;
        }
        if (ref[1] === n || !locals.has(ref[1])) continue;
        if (decls.has(ref[1])) visit(ref[1]);
        else {
          movable = false;
          fail(`${dest}: type ${n} of ${compDest} depends on the non-exported local ${ref[1]} — move the type into packages/backend or packages/shared-types by hand`);
        }
      }
    };
    names.forEach(visit);
    if (!movable) continue;
    const sharedRel = imp.spec.slice("@/components/".length);
    const sharedPath = `${FIXUPS.sharedTypesDir}/${sharedRel}.ts`;
    const sharedSpec = `@realy/shared-types/${sharedRel}`;
    const ordered = [...closure].sort((a, b) => decls.get(a).start - decls.get(b).start);
    const values = ordered.filter((n) => decls.get(n).kind === "const");
    const types = ordered.filter((n) => decls.get(n).kind !== "const");
    const prev = out.get(sharedPath)?.content ?? `// Shared by packages/backend and the user app (moved from ${compDest.replace(/^apps\/user\//, "")} by scripts/split).\n`;
    out.set(sharedPath, { kind: "generated", content: prev + ordered.filter((n) => !new RegExp(`export (?:interface|type|const) ${n}\\b`).test(prev)).map((n) => `\n${decls.get(n).text}\n`).join("") });
    let cc = comp.content;
    for (const n of [...ordered].reverse()) {
      const d = extractTypeDecls(cc).get(n);
      cc = cc.slice(0, d.start).replace(/\n+$/, "\n") + cc.slice(d.end).replace(/^\n+/, "\n");
    }
    const importLines = (values.length ? `import { ${values.join(", ")} } from "${sharedSpec}";\n` : "") + (types.length ? `import type { ${types.join(", ")} } from "${sharedSpec}";\n` : "");
    const lastImport = [...scanImports(cc)].filter((i) => /^(?:[\n;])?\s*import/.test(i.statement)).pop();
    const at = lastImport ? cc.indexOf("\n", lastImport.end) + 1 : 0;
    cc = `${cc.slice(0, at)}${importLines}${cc.slice(at)}`;
    const reexport = (values.length ? `export { ${values.join(", ")} };\n` : "") + (types.length ? `export type { ${types.join(", ")} };\n` : "");
    comp.content = cc.replace(/\n?$/, "\n") + reexport;
    e.content = e.content.slice(0, imp.start) + sharedSpec + e.content.slice(imp.end);
  }
}

// ─────────────────────────────── 8. Patches ───────────────────────────────
const patched = [];
for (const patch of PATCHES) {
  const isRoot = !/^(apps|packages)\//.test(patch.file);
  const entry = out.get(patch.file) ?? (isRoot && exists(patch.file) ? { content: fs.readFileSync(abs(patch.file), "utf8"), kind: "patched-root" } : null);
  if (!entry) {
    (patch.hard ? fail : warnings.push.bind(warnings))(`patch target missing: ${patch.file} (${patch.why})`);
    continue;
  }
  let c = entry.content;
  const matches = (re) => {
    re.lastIndex = 0;
    return re.test(c);
  };
  if (patch.done && patch.done.test(c) && !patch.replace.some(([re]) => matches(re))) continue;
  let ok = true;
  for (const [re, to] of patch.replace) {
    if (matches(re)) c = c.replace(re, to);
    else ok = false;
  }
  if (!ok && !patch.hard && !patch.done) {
    // Soft patches are atomic: a partly applicable cleanup is skipped entirely (the leftover is inert).
    warnings.push(`patch skipped: ${patch.file} (${patch.why}) — the source changed; update PATCHES in scripts/split/config.mjs`);
    continue;
  }
  if (patch.insertAfterImports && !c.includes(patch.insertAfterImports)) {
    const imports = scanImports(c).filter((i) => /^(?:[\n;])?\s*import/.test(i.statement));
    const at = imports.length ? c.indexOf("\n", imports[imports.length - 1].end) + 1 : 0;
    c = `${c.slice(0, at)}${patch.insertAfterImports}${c.slice(at)}`;
  }
  if (!ok && !(patch.done && patch.done.test(c))) {
    (patch.hard ? fail : warnings.push.bind(warnings))(`patch did not apply cleanly: ${patch.file} (${patch.why}) — the source changed; update PATCHES in scripts/split/config.mjs`);
    if (patch.hard) continue;
  }
  entry.content = c;
  if (!out.has(patch.file)) out.set(patch.file, entry);
  patched.push(patch.file);
}

// APP_SURFACE gating is gone: no output file may still read it.
for (const [dest, e] of out) if (typeof e.content === "string" && /APP_SURFACE/.test(e.content) && !dest.startsWith("docs/")) fail(`${dest} still references APP_SURFACE (single-app gating) — remove it`);

// ─────────────────────────────── 9. CSS: the user app no longer carries the admin palette ───────────────────────────────
const userUsesAdminVariant = [...out].some(([d, e]) => d.startsWith("apps/user/") && isCode(d) && typeof e.content === "string" && e.content.includes("auth-variant-admin"));
const ADMIN_SELECTOR = userUsesAdminVariant ? /\[data-surface="admin"\]|\.control-room\b/ : /\[data-surface="admin"\]|\.control-room\b|\.auth-variant-admin\b/;
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" || s[i] === "[") depth++;
    else if (s[i] === ")" || s[i] === "]") depth--;
    else if (s[i] === sep && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}
function pruneCss(css) {
  let res = "";
  let i = 0;
  let stmtStart = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      i = css.indexOf("*/", i + 2) + 2;
      continue;
    }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = css.indexOf(ch, i + 1) + 1;
      continue;
    }
    if (ch === ";") {
      res += css.slice(stmtStart, i + 1);
      stmtStart = ++i;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth) {
        if (css.startsWith("/*", j)) {
          j = css.indexOf("*/", j + 2) + 2;
          continue;
        }
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const prelude = css.slice(stmtStart, i);
      const body = css.slice(i + 1, j - 1);
      const lead = /^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/.exec(prelude)[1];
      const sel = prelude.slice(lead.length);
      if (/^@(media|supports|layer|container)\b/.test(sel)) {
        const inner = pruneCss(body);
        if (inner.trim() === "" && body.trim() !== "") res += "";
        else res += `${prelude}{${inner}}`;
      } else if (sel.startsWith("@")) res += css.slice(stmtStart, j);
      else {
        const parts = splitTopLevel(sel, ",");
        const keep = parts.filter((p) => !ADMIN_SELECTOR.test(p));
        if (keep.length === parts.length) res += css.slice(stmtStart, j);
        else if (keep.length) {
          const trailing = /\s*$/.exec(sel)[0];
          res += `${lead}${keep.map((p, k) => (k === 0 ? p.replace(/^\s+/, "") : p)).join(",").replace(/\s*$/, "")}${trailing}{${body}}`;
        }
      }
      stmtStart = i = j;
      continue;
    }
    i++;
  }
  return res + css.slice(stmtStart);
}
for (const e of out.values()) if (e.css === "pruneAdmin") e.content = pruneCss(e.content).replace(/\n{3,}/g, "\n\n");

// ─────────────────────────────── 10. i18n split ───────────────────────────────
const catalogs = Object.fromEntries(i18nSources.map((p) => [path.basename(p, ".json"), JSON.parse(fs.readFileSync(abs(p), "utf8"))]));
const getPath = (obj, dotted) => dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
for (const m of FIXUPS.messageMoves) {
  for (const [locale, cat] of Object.entries(catalogs)) {
    const [ns, ...rest] = m.from.split(".");
    const value = getPath(cat, m.from);
    if (value === undefined) {
      if (getPath(cat, m.to) === undefined) warnings.push(`message move ${m.from} → ${m.to}: neither exists in ${locale}`);
      continue;
    }
    if (getPath(cat, m.to) !== undefined) fail(`message move ${m.from} → ${m.to}: target already exists in ${locale}`);
    const parent = rest.slice(0, -1).reduce((o, k) => o[k], cat[ns]);
    delete parent[rest[rest.length - 1]];
    // Insert the new namespace right after its old parent namespace (keeps catalogs readable and diffs stable).
    const entries = Object.entries(cat);
    const at = entries.findIndex(([k]) => k === ns) + 1;
    entries.splice(at, 0, [m.to, value]);
    for (const k of Object.keys(cat)) delete cat[k];
    for (const [k, v] of entries) cat[k] = v;
  }
}
const en = catalogs["en-US"];
if (!en) fail("src/i18n/messages/en-US.json not found");
const namespaces = [...new Set(Object.values(catalogs).flatMap((c) => Object.keys(c)))];
const filesOf = (pred) => [...out].filter(([d, e]) => pred(d) && typeof e.content === "string" && isCode(d)).map(([, e]) => e.content);
const refsIn = (texts) => {
  const all = texts.join("\n");
  return new Set(namespaces.filter((ns) => new RegExp(`["'\`]${ns}(?:\\.|["'\`])`).test(all)));
};
/** Files reachable from `seeds` through imports, resolved with `project`'s aliases (what that bundle can execute). */
function reachable(project, seeds) {
  const seen = new Set();
  const queue = [...seeds];
  const has = (p) => out.has(p);
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const content = out.get(f)?.content;
    if (typeof content !== "string" || !isCode(f)) continue;
    for (const { spec } of scanImports(content)) {
      let base = null;
      if (spec.startsWith(".")) base = posix(path.normalize(path.join(path.dirname(f), spec)));
      else if (spec.startsWith("@/") || spec.startsWith("@realy/")) base = resolveAlias(spec, ALIASES[project]);
      const target = base && probe(base, has);
      if (target) queue.push(target);
    }
  }
  return [...seen];
}
const contentsOf = (paths) => paths.map((p) => out.get(p)?.content).filter((c) => typeof c === "string");
const userRefs = refsIn(filesOf((d) => d.startsWith("apps/user/")));
const adminFiles = [...out.keys()].filter((d) => d.startsWith("apps/admin/") && isCode(d));
const adminReach = reachable("apps/admin", adminFiles);
const adminRefs = refsIn(contentsOf(adminFiles));
const adminPkgRefs = refsIn(contentsOf(adminReach.filter((p) => p.startsWith("packages/"))));
const pkgRefs = refsIn(filesOf((d) => d.startsWith("packages/")));
const adminOnly = new Set([...I18N.adminNamespaces, ...namespaces.filter((ns) => adminRefs.has(ns) && !userRefs.has(ns) && !pkgRefs.has(ns))]);
// The user app may not use admin-only messages (any admin.<key> left in user code is a boundary leak).
for (const [dest, e] of out) {
  if (!dest.startsWith("apps/user/") || typeof e.content !== "string" || !isCode(dest)) continue;
  for (const ns of adminOnly)
    for (const m of e.content.matchAll(new RegExp(`["'\`]${ns}\\.([A-Za-z0-9_]+)`, "g")))
      if (en && getPath(en, `${ns}.${m[1]}`) !== undefined) fail(`${dest}: user app uses admin-only message "${ns}.${m[1]}…" — move it to a user namespace (FIXUPS.messageMoves)`);
}
const selection = {
  "apps/user": namespaces.filter((ns) => !adminOnly.has(ns)),
  // Admin: its own namespaces + those its code and the backend modules it can reach reference.
  "apps/admin": namespaces.filter((ns) => adminOnly.has(ns) || adminRefs.has(ns) || adminPkgRefs.has(ns)),
};
const i18nSummary = {};
for (const [project, dir] of Object.entries(I18N.outputs)) {
  for (const [locale, cat] of Object.entries(catalogs)) {
    const picked = Object.fromEntries(Object.entries(cat).filter(([k]) => selection[project].includes(k)));
    out.set(`${dir}/${locale}.json`, { kind: "generated", content: `${JSON.stringify(picked, null, 2)}\n` });
  }
  i18nSummary[project] = selection[project];
}

// ─────────────────────────────── 11. Root tooling (scripts/, tests/) keeps working ───────────────────────────────
const rootTooling = [...walk(ROOT, "scripts"), ...walk(ROOT, "tests")].filter((p) => isCode(p) && !p.startsWith("scripts/split/") && !out.has(p));
for (const p of rootTooling) {
  const original = fs.readFileSync(abs(p), "utf8");
  let c = rewriteRelative(p, p, original);
  c = c.replace(/(["'`/.])src\/i18n\/messages/g, "$1apps/user/src/i18n/messages");
  c = c.replace(/\[\s*"src\/app",\s*"src\/components"\s*\]/g, '["apps/user/src/app", "apps/user/src/components", "apps/admin/src/app", "apps/admin/src/components"]');
  for (const [re, to] of messageMoveRes) c = c.replace(re, to);
  if (c !== original) out.set(p, { kind: "patched-root", content: c });
}

// ─────────────────────────────── 12. tsconfig paths + package.json dependencies ───────────────────────────────
for (const [dest, e] of out) {
  if (!dest.endsWith("tsconfig.json") || e.kind !== "template" || !e.content.includes('"$aliases"')) continue;
  const project = projectOf(dest);
  const dir = path.dirname(dest);
  const paths = {};
  for (const [pattern, target] of ALIASES[project]) {
    let rel = posix(path.relative(dir, target));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    paths[pattern] = [rel];
  }
  e.content = e.content.replace('"$aliases"', JSON.stringify(paths, null, 2).replace(/\n/g, "\n    "));
}

const workspaceProjects = [...out.keys()].filter((d) => /^(apps|packages)\/[^/]+\/package\.json$/.test(d)).map((d) => path.dirname(d));
const projectNames = Object.fromEntries(workspaceProjects.map((p) => [p, JSON.parse(out.get(`${p}/package.json`).content).name]));
const nameToProject = Object.fromEntries(Object.entries(projectNames).map(([p, n]) => [n, p]));
const typesFor = (dep) => `@types/${dep.startsWith("@") ? dep.slice(1).replace("/", "__") : dep}`;
const version = (dep, where) => {
  const v = rootVersions[dep];
  if (!v) fail(`${where}: dependency "${dep}" is not declared in the root package.json`);
  return v ?? "*";
};
const depScan = (project) => {
  const deps = new Set();
  const internal = new Set();
  for (const [d, e] of out) {
    if (projectOf(d) !== project || typeof e.content !== "string" || !isCode(d) || /\/(package|tsconfig)\.json$/.test(d)) continue;
    for (const { spec } of scanImports(e.content)) {
      if (spec.startsWith(".") || spec.startsWith("/") || isBuiltin(spec)) continue;
      if (spec.startsWith("@/")) {
        if (project.startsWith("packages/") && isAppProvided(spec)) continue;
        const target = resolveAlias(spec, ALIASES[project] ?? []);
        if (target && projectOf(target) !== project && projectNames[projectOf(target)]) internal.add(projectNames[projectOf(target)]);
        continue;
      }
      const name = packageName(spec);
      if (nameToProject[name]) internal.add(name);
      else deps.add(name);
    }
  }
  return { deps, internal };
};
const pkgSummary = {};
for (const project of workspaceProjects) {
  const file = `${project}/package.json`;
  const pkg = JSON.parse(out.get(file).content);
  const { deps, internal } = depScan(project);
  const fill = (section) => {
    for (const [k, v] of Object.entries(pkg[section] ?? {})) if (v === "$root") pkg[section][k] = version(k, file);
  };
  fill("dependencies");
  fill("devDependencies");
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  for (const dep of deps) {
    if (dep.startsWith("@types/")) continue;
    if (!(dep in pkg.dependencies) && !(dep in pkg.devDependencies)) pkg.dependencies[dep] = version(dep, file);
  }
  if ("next" in pkg.dependencies) for (const peer of NEXT_PEERS) if (rootVersions[peer] && !(peer in pkg.dependencies)) pkg.dependencies[peer] = rootVersions[peer];
  for (const name of internal) if (name !== pkg.name && LAYERS.indexOf(nameToProject[name]) < LAYERS.indexOf(project)) pkg.dependencies[name] = "workspace:*";
  const typed = new Set([...Object.keys(pkg.dependencies), "node"]);
  if ([...out.keys()].some((d) => projectOf(d) === project && d.endsWith(".tsx"))) typed.add("react").add("react-dom");
  for (const dep of typed) if (rootVersions[typesFor(dep)] && !(typesFor(dep) in pkg.devDependencies)) pkg.devDependencies[typesFor(dep)] = rootVersions[typesFor(dep)];
  if (!("typescript" in pkg.devDependencies) && rootVersions.typescript) pkg.devDependencies.typescript = rootVersions.typescript;
  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  pkg.dependencies = sort(pkg.dependencies);
  pkg.devDependencies = sort(pkg.devDependencies);
  if (!Object.keys(pkg.dependencies).length) delete pkg.dependencies;
  out.get(file).content = `${JSON.stringify(pkg, null, 2)}\n`;
  pkgSummary[project] = Object.keys(pkg.dependencies ?? {}).length;
}

// Root package.json: workspace scripts from the template, tooling deps (tests/, scripts/) with the current versions.
{
  const tmpl = out.get("package.json");
  if (!tmpl) fail("templates/package.json missing");
  else {
    const pkg = JSON.parse(tmpl.content);
    const deps = new Set(Object.keys(pkg.devDependencies ?? {}));
    for (const p of [...walk(ROOT, "tests"), ...walk(ROOT, "scripts")].filter((f) => isCode(f) && !f.startsWith("scripts/split/")))
      for (const { spec } of scanImports(out.get(p)?.content ?? fs.readFileSync(abs(p), "utf8")))
        if (!spec.startsWith(".") && !spec.startsWith("@/") && !isBuiltin(spec) && !nameToProject[packageName(spec)]) deps.add(packageName(spec));
    pkg.devDependencies = {};
    for (const d of [...deps].sort()) pkg.devDependencies[d] = version(d, "package.json (root tooling)");
    for (const d of Object.keys(pkg.devDependencies)) if (rootVersions[typesFor(d)]) pkg.devDependencies[typesFor(d)] = rootVersions[typesFor(d)];
    pkg.devDependencies["@types/node"] = rootVersions["@types/node"];
    pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)));
    pkg.packageManager = rootPkg.packageManager;
    tmpl.content = `${JSON.stringify(pkg, null, 2)}\n`;
  }
}

// vitest aliases generated from the root alias table (tests import backend and route modules by "@/…").
{
  const v = out.get("vitest.config.mts");
  if (v?.content.includes("__ALIASES__")) {
    const lines = [...ALIASES.root]
      .sort(([a], [b]) => b.replace("*", "").length - a.replace("*", "").length)
      .map(([pattern, target]) => {
        const find = `/^${pattern.replace(/[.+?^${}()|[\]\\/]/g, "\\$&").replace("\\*", "(.*)").replace("*", "(.*)")}$/`;
        return `      { find: ${find}, replacement: path.resolve(import.meta.dirname, ${JSON.stringify(target.replace("*", "$1"))}) },`;
      });
    v.content = v.content.replace("__ALIASES__", lines.join("\n").trimStart());
  }
}

// pnpm-workspace.yaml: workspace packages + the existing build-script allowlist.
{
  const current = fs.readFileSync(abs("pnpm-workspace.yaml"), "utf8");
  const content = /^packages:/m.test(current) ? current : `packages:\n  - "apps/*"\n  - "packages/*"\n${current}`;
  out.set("pnpm-workspace.yaml", { kind: "patched-root", content });
}
// .gitignore: generated client moved; per-app build output.
{
  let g = fs.readFileSync(abs(".gitignore"), "utf8");
  g = g.replace(/^\/src\/generated$/m, "packages/database/src/generated").replace(/^\/\.next\/$/m, ".next/").replace(/^\/node_modules$/m, "node_modules");
  out.set(".gitignore", { kind: "patched-root", content: g });
}

// .dockerignore: patterns apply at every depth now (apps/*/.next, per-project node_modules); never ship a local client.
if (exists(".dockerignore")) {
  let d = fs.readFileSync(abs(".dockerignore"), "utf8");
  d = d.replace(/^node_modules$/m, "**/node_modules").replace(/^\.next$/m, "**/.next");
  if (!d.includes("packages/database/src/generated")) d = `${d.replace(/\n?$/, "\n")}packages/database/src/generated\n`;
  out.set(".dockerignore", { kind: "patched-root", content: d });
}

// ─────────────────────────────── 13. Validate the planned tree ───────────────────────────────
const codeFiles = new Map([...out].filter(([, e]) => typeof e.content === "string").map(([d, e]) => [d, e.content]));
for (const msg of checkBoundaries(codeFiles, ALIASES)) fail(msg);
for (const [d, e] of out) if (typeof e.content === "string" && e.kind !== "template" && e.content.includes("$root")) fail(`${d}: unresolved $root placeholder`);

// ─────────────────────────────── 14. Report / apply ───────────────────────────────
const byProject = {};
for (const [d, e] of out) {
  const p = projectOf(d);
  byProject[p] ??= { move: 0, copy: 0, template: 0, generated: 0, "patched-root": 0 };
  byProject[p][e.kind]++;
}
const unconsumed = oldFiles.filter((p) => !consumed.has(p) && !i18nSources.includes(p));
for (const p of unconsumed) fail(`not carried over: ${p}`);

if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.error(`\nsplit: ${errors.length} problem(s) — nothing was changed:\n`);
  for (const e of [...new Set(errors)]) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const summary = () => {
  console.log("\nFiles per project (move / copy / template / generated / patched):");
  for (const [p, s] of Object.entries(byProject).sort()) console.log(`  ${p.padEnd(22)} ${s.move} / ${s.copy} / ${s.template} / ${s.generated} / ${s["patched-root"]}`);
  console.log(`\nAdmin copies of shared UI: ${[...out.values()].filter((e) => e.adminShared).length} file(s)`);
  console.log(`i18n namespaces: user ${i18nSummary["apps/user"].length}, admin ${i18nSummary["apps/admin"].length} (admin-owned: ${[...adminOnly].join(", ")}; the other ${i18nSummary["apps/admin"].length - adminOnly.size} are copies kept in sync from apps/user by scripts/i18n-sync.mjs)`);
  console.log(`Patched: ${patched.join(", ")}`);
  console.log(`Dropped (${dropped.length}): ${[...new Set(dropped.map((d) => d.replace(/^src\/generated\/.*? — /, "src/generated/** — ")))].join("\n  ")}`);
};

if (DRY) {
  summary();
  console.log("\nsplit: dry run OK — no problems found, nothing written.");
  process.exit(0);
}

for (const [dest, e] of out) {
  fs.mkdirSync(path.dirname(abs(dest)), { recursive: true });
  fs.writeFileSync(abs(dest), e.content);
}
fs.rmSync(abs("src"), { recursive: true, force: true });
fs.rmSync(abs("prisma"), { recursive: true, force: true });
for (const f of ROOT_REMOVED) if (!out.has(f)) fs.rmSync(abs(f), { force: true });
summary();
console.log(`\nsplit: done — ${out.size} files written. Next: pnpm install && pnpm typecheck (see docs/architecture/apps.md).`);
