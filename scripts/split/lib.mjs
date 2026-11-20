// Shared helpers for scripts/split/run.mjs and scripts/split/check-boundaries.mjs. Node built-ins only.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

export const posix = (p) => p.split(path.sep).join("/");

/** All files under `dir` (relative to `root`, posix), skipping node_modules, .next and generated output dirs. */
export function walk(root, dir, { skip = ["node_modules", ".next", ".turbo"] } = {}) {
  const out = [];
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  const visit = (rel) => {
    const st = fs.lstatSync(path.join(root, rel));
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
        if (skip.includes(name)) continue;
        visit(rel ? `${rel}/${name}` : name);
      }
    } else out.push(posix(rel));
  };
  visit(posix(dir));
  return out;
}

/** Glob → RegExp. Supports `**`, `*`; everything else is literal (route paths contain `[`, `(`, `.`). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const globCache = new Map();
export function matchGlob(glob, p) {
  let re = globCache.get(glob);
  if (!re) globCache.set(glob, (re = globToRegExp(glob)));
  return re.test(p);
}
/** The part of `p` matched by the trailing `**` (or `*`) of `glob` — used to re-root moved trees. */
export function globRest(glob, p) {
  const base = glob.replace(/\/?\*\*.*$/, "").replace(/\/?\*[^/]*$/, "");
  if (!base) return p;
  return p === base ? "" : p.slice(base.length + 1);
}

export const CODE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

/**
 * Import/export specifiers in a source file with their positions (so they can be rewritten in place).
 * Covers `import … from "x"`, `export … from "x"`, side-effect `import "x"`, dynamic `import("x")` and `require("x")`.
 */
export function scanImports(src) {
  const out = [];
  const patterns = [
    /(^|[\n;])\s*(import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s*(["'])([^"'\n]+)\4/g,
    /(^|[\n;])\s*import\s*(["'])([^"'\n]+)\2/g,
    /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  ];
  for (const [i, re] of patterns.entries()) {
    for (const m of src.matchAll(re)) {
      const spec = i === 0 ? m[5] : i === 1 ? m[3] : m[2];
      const quote = i === 0 ? m[4] : i === 1 ? m[2] : m[1];
      const end = m.index + m[0].lastIndexOf(quote);
      const start = end - spec.length;
      const typeOnly = i === 0 && (!!m[3] || /^\s*(?:import|export)\s+type\s/.test(m[0].slice(m[1].length)));
      out.push({ spec, start, end, typeOnly, statement: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start).filter((x, i, all) => i === 0 || all[i - 1].start !== x.start);
}

/** Replace specifiers using `fn(spec) → newSpec | null`. */
export function rewriteSpecifiers(src, fn) {
  const imports = scanImports(src);
  let out = "";
  let last = 0;
  for (const imp of imports) {
    const next = fn(imp.spec, imp);
    if (next == null || next === imp.spec) continue;
    out += src.slice(last, imp.start) + next;
    last = imp.end;
  }
  return out + src.slice(last);
}

export const isBuiltin = (spec) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0]);
export const packageName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/** Probe extensions against a set (or fs) of files; returns the matching path or null. */
export function probe(base, exists) {
  for (const ext of RESOLVE_EXT) if (exists(base + ext)) return base + ext;
  return null;
}

/**
 * Resolve an alias specifier through a tsconfig-style alias table ([pattern, target] pairs, longest prefix wins,
 * exact patterns before wildcards — the same rules TypeScript and Turbopack apply to `paths`).
 */
export function resolveAlias(spec, aliases) {
  let best = null;
  for (const [pattern, target] of aliases) {
    if (!pattern.includes("*")) {
      if (spec === pattern) return target;
      continue;
    }
    const prefix = pattern.slice(0, pattern.indexOf("*"));
    const suffix = pattern.slice(pattern.indexOf("*") + 1);
    if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
      if (!best || prefix.length > best.prefix.length) best = { prefix, suffix, target };
    }
  }
  if (!best) return null;
  const star = spec.slice(best.prefix.length, spec.length - best.suffix.length);
  return best.target.replace("*", star);
}

export function relativeSpecifier(fromFile, toFile) {
  let rel = posix(path.relative(path.dirname(fromFile), toFile)).replace(/\.(tsx?|mts)$/, "").replace(/\/index$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** Project (workspace member) owning a repo-relative path. */
export function projectOf(p) {
  const m = /^(apps|packages)\/([^/]+)\//.exec(p);
  return m ? `${m[1]}/${m[2]}` : "root";
}

/**
 * Which projects may a project depend on (the isolation rules, docs/architecture/apps.md).
 * `apps/user` must never reach `apps/admin` or the admin API-client entry; and vice versa.
 */
export const ALLOWED_DEPS = {
  "apps/user": ["apps/user", "packages/backend", "packages/database", "packages/shared-utils", "packages/api-client", "packages/auth-core", "packages/shared-types"],
  "apps/admin": ["apps/admin", "packages/backend", "packages/database", "packages/shared-utils", "packages/api-client", "packages/auth-core", "packages/shared-types"],
  "packages/backend": ["packages/backend", "packages/database", "packages/shared-utils", "packages/auth-core", "packages/shared-types"],
  "packages/database": ["packages/database", "packages/backend", "packages/shared-utils", "packages/auth-core", "packages/shared-types"],
  "packages/shared-utils": ["packages/shared-utils"],
  "packages/api-client": ["packages/api-client", "packages/shared-types"],
  "packages/auth-core": ["packages/auth-core"],
  "packages/shared-types": ["packages/shared-types"],
};
/** Files no app other than the named one may import (entry points of per-app packages). */
export const PRIVATE_ENTRIES = [
  { file: "packages/api-client/src/admin.ts", only: "apps/admin" },
  { file: "packages/api-client/src/user.ts", only: "apps/user" },
];

/** Specifiers every app provides itself (its own message catalogs and server i18n loader); packages may use them. */
export const APP_PROVIDED = ["@/i18n/server", "@/i18n/messages/*"];
export const isAppProvided = (spec) => APP_PROVIDED.some((p) => (p.endsWith("*") ? spec.startsWith(p.slice(0, -1)) : spec === p));

/** Generated Prisma client: produced by `prisma generate`, not tracked. */
export const isGenerated = (p) => p.startsWith("packages/database/src/generated/");

/**
 * Check every import of every code file in `files` (Map path → content) against the alias tables and isolation
 * rules. Returns a list of human-readable violations.
 */
export function checkBoundaries(files, aliasTables) {
  const errors = [];
  const exists = (p) => files.has(p) || isGenerated(p);
  for (const [file, content] of files) {
    if (!CODE_EXT.test(file) || typeof content !== "string") continue;
    const project = projectOf(file);
    const allowed = ALLOWED_DEPS[project];
    if (!allowed) continue;
    const aliases = aliasTables[project];
    for (const { spec } of scanImports(content)) {
      if (spec.includes("/.next/")) continue; // generated route types (next-env.d.ts)
      let target = null;
      if (spec.startsWith(".")) {
        target = probe(posix(path.normalize(path.join(path.dirname(file), spec))), exists);
        if (!target) {
          errors.push(`${file}: unresolved relative import "${spec}"`);
          continue;
        }
      } else if (spec.startsWith("@/") || spec.startsWith("@realy/")) {
        // App-provided specifiers resolve to the importing app's own file when compiled into an app.
        if (project.startsWith("packages/") && isAppProvided(spec)) continue;
        const mapped = resolveAlias(spec, aliases);
        if (!mapped) {
          errors.push(`${file}: "${spec}" is not available to ${project} (no alias maps it — wrong side of the user/admin boundary?)`);
          continue;
        }
        target = probe(mapped, exists);
        if (!target) {
          errors.push(`${file}: "${spec}" → ${mapped} does not exist in ${project}'s view (imports code that lives in the other app?)`);
          continue;
        }
      } else continue;
      const owner = projectOf(target);
      if (!allowed.includes(owner)) errors.push(`${file}: imports ${target} (${owner}) — ${project} may not depend on ${owner}`);
      for (const pe of PRIVATE_ENTRIES) if (target === pe.file && project.startsWith("apps/") && project !== pe.only) errors.push(`${file}: imports ${pe.file}, which only ${pe.only} may use`);
    }
  }
  return errors;
}
