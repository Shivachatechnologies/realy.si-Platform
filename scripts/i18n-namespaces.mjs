/**
 * Client message manifest (apps/<app>/src/i18n/client-namespaces.json): which top-level message namespaces each
 * client-message boundary must send to the browser.
 *
 * The browser never gets the whole catalog (it used to: ~1 MB of JSON in every HTML response plus ~0.9 MB of JS).
 * Layouts render <ClientMessages scope="<dir relative to src/app>"> (components/i18n/client-messages.tsx); the root
 * layout passes its own scope to <I18nProvider>. For every boundary this script follows the imports of the route
 * files it covers (page, layout, template, loading, error, not-found, default, …, not inside a deeper boundary),
 * marks everything reachable from a "use client" module as client code, and collects the namespaces of the message
 * keys that code can render:
 *   - client code: every string / template-literal head shaped like "<namespace>.…" (keys in t() calls, in
 *     `labelKey` tables, in `${prefix}` constants, …);
 *   - server code of the app: the same, except literals passed straight to t() (rendered on the server), because
 *     server components hand keys to client components as props.
 * A boundary receives what it needs minus what enclosing boundaries already provide.
 *
 *   node scripts/i18n-namespaces.mjs            rewrite the manifests (also run by `pnpm i18n:sync`)
 *   node scripts/i18n-namespaces.mjs --check    exit 1 if a manifest is stale or a rule is broken (`pnpm i18n:check`)
 *
 * Rules checked: every scope string matches the file that renders it; every route file whose client code uses
 * messages is inside a boundary; client code never imports a message catalog or the server translator
 * (@/i18n/translate value import), which would put whole catalogs into the client bundle.
 * Anything the heuristics miss is still caught at runtime: the client provider fetches an undelivered namespace
 * from /api/i18n/<locale>/<ns> and warns in the console.
 */
import fs from "node:fs";
import path from "node:path";
import { ALIASES } from "./split/config.mjs";
import { CODE_EXT, probe, posix, resolveAlias, scanImports, walk } from "./split/lib.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const APPS = ["user", "admin"];
const ROUTE_FILE = /(?:^|\/)(page|layout|template|loading|error|not-found|forbidden|unauthorized|default)\.(?:tsx|ts|jsx|js)$/;
/** Server code is followed only inside these projects (backend/database code never renders client components). */
const SERVER_FOLLOW = /^(apps\/[^/]+|packages\/shared-utils|packages\/shared-types)\//;

const read = (() => {
  const cache = new Map();
  return (p) => {
    if (!cache.has(p)) cache.set(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    return cache.get(p);
  };
})();

const allFiles = new Set(
  [...walk(ROOT, "apps"), ...walk(ROOT, "packages")].filter((p) => !p.startsWith("packages/database/src/generated/")),
);
const exists = (p) => allFiles.has(p);
const isClientModule = (src) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(src);

/** Source without comments (prose such as `"crm.stages.lead"` in a doc comment is not a key). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");

/**
 * Message units referenced by string literals and template-literal heads shaped like keys of a known namespace.
 * A unit is what gets delivered: "ns.sub" (that subtree or leaf of a namespace), "ns.*" (the namespace's direct
 * string messages — from `ns.${code}`), or "ns" (the whole namespace — from heads such as `ns.${a}.${b}`).
 */
function keyUnits(raw, namespaces) {
  const src = stripComments(raw);
  const out = [];
  const re = /(["'])([A-Za-z]\w*\.[\w.$-]*)\1|`([A-Za-z]\w*\.[\w.-]*)(`|\$\{[^`{}]*\}`|\$\{)/g;
  for (const m of src.matchAll(re)) {
    const value = m[2] ?? m[3];
    const segs = value.split(".");
    if (!namespaces.has(segs[0])) continue;
    // Complete key segments: all of a plain string; for a template head, the ones before the first ${…}.
    const next = m[4];
    const complete = m[2] !== undefined || next === "`" ? segs : segs.slice(0, -1);
    let unit;
    if (complete.length >= 2 && complete[1]) unit = `${segs[0]}.${complete[1]}`;
    else if (next && next !== "`" && next !== "${" && value.endsWith(".")) unit = `${segs[0]}.*`; // exactly `ns.${code}`
    else unit = segs[0];
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    out.push({ unit, full: m[2] !== undefined || next === "`" ? value : null, direct: /(?:^|[^\w$.])t\(\s*$/.test(before) });
  }
  return out;
}

/** Is `unit` delivered by the set `units` (itself or an enclosing unit)? */
function covered(unit, units) {
  const segs = unit.split(".");
  return segs.some((_, i) => units.has(segs.slice(0, i + 1).join(".")));
}

/**
 * Lazy subtrees: never inlined into the HTML. Keys under them that appear literally in code are delivered one by
 * one; dynamic ones (`errors.reasons.${reason}`, 47 KB of API error reasons) are fetched after hydration by the
 * components that may show them (usePrefetchMessages) or on first miss. Only where the fallback endpoint is public:
 * the admin app's /api is behind the console gate, so its login page keeps them inline.
 */
const LAZY = { user: ["errors.reasons"], admin: [] };

/** The part of a catalog one unit selects (mirrors pickUnit in apps/<app>/src/i18n/catalog.ts). */
function pickUnit(catalog, unit) {
  const dot = unit.indexOf(".");
  const ns = dot < 0 ? unit : unit.slice(0, dot);
  const sub = dot < 0 ? null : unit.slice(dot + 1);
  const node = catalog[ns];
  if (sub === null) return node;
  if (!node || typeof node !== "object") return undefined;
  if (sub === "*") return Object.fromEntries(Object.entries(node).filter(([, v]) => typeof v === "string"));
  if (sub in node) return { [sub]: node[sub] };
  const dotted = Object.entries(node).filter(([k]) => k.startsWith(`${sub}.`));
  if (dotted.length) return Object.fromEntries(dotted);
  const first = sub.slice(0, sub.indexOf("."));
  if (first && node[first] && typeof node[first] === "object") {
    const inner = pickUnit({ x: node[first] }, `x.${sub.slice(first.length + 1)}`);
    return inner === undefined ? undefined : { [first]: inner };
  }
  return undefined;
}

function analyzeApp(app) {
  const appDir = `apps/${app}/src/app`;
  const aliases = ALIASES[`apps/${app}`];
  const catalog = JSON.parse(read(`apps/${app}/src/i18n/messages/en-US.json`));
  const namespaces = new Set(Object.keys(catalog));
  const lazy = new Set(LAZY[app] ?? []);
  const errors = [];

  const resolve = (from, spec) => {
    if (spec.startsWith(".")) return probe(posix(path.normalize(path.join(path.dirname(from), spec))), exists);
    if (spec.startsWith("@/") || spec.startsWith("@realy/")) {
      const mapped = resolveAlias(spec, aliases);
      return mapped ? probe(mapped, exists) : null;
    }
    return null; // npm packages
  };

  // Per file: is it a client module, its (value) imports, its key namespaces.
  const info = new Map();
  const fileInfo = (p) => {
    let i = info.get(p);
    if (i) return i;
    const src = CODE_EXT.test(p) ? read(p) : "";
    i = {
      client: isClientModule(src),
      imports: scanImports(src)
        .filter((imp) => !imp.typeOnly)
        .map((imp) => ({ spec: imp.spec, target: resolve(p, imp.spec) }))
        .filter((imp) => imp.target),
      keys: keyUnits(src, namespaces),
    };
    info.set(p, i);
    return i;
  };

  const catalogImport = (target) =>
    /\/i18n\/messages\/[^/]+\.json$/.test(target) || target === "packages/shared-utils/src/i18n/translate.ts";

  /** Namespaces the client code reachable from `entry` can render. */
  const memo = new Map();
  function needs(entry) {
    if (memo.has(entry)) return memo.get(entry);
    const result = new Set();
    const seen = new Set();
    const stack = [[entry, false]];
    while (stack.length) {
      const [file, inClient] = stack.pop();
      const fi = fileInfo(file);
      const client = inClient || fi.client;
      const id = `${file}|${client}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!client && !SERVER_FOLLOW.test(file)) continue;
      for (const k of fi.keys) {
        let unit = k.unit;
        if (lazy.has(unit)) {
          if (!k.full?.startsWith(`${unit}.`)) continue; // dynamic: loaded after hydration
          unit = k.full; // a literal key: deliver just that message
        }
        if (client || !k.direct) {
          if (why && !result.has(unit)) console.log(`    why ${entry} → ${unit} (${file}${client ? ", client" : ""})`);
          result.add(unit);
        }
      }
      for (const imp of fi.imports) {
        if (client && catalogImport(imp.target)) {
          errors.push(`${file}: client code imports "${imp.spec}" (a full message catalog) — use useT() from @/i18n/client`);
          continue;
        }
        if (!CODE_EXT.test(imp.target)) continue;
        const ti = fileInfo(imp.target);
        stack.push([imp.target, client || ti.client]);
      }
    }
    memo.set(entry, result);
    return result;
  }

  // Boundaries: files rendering <ClientMessages scope="…"> or the root <I18nProvider … messages={…("<scope>")}>.
  const appFiles = [...allFiles].filter((p) => p.startsWith(`${appDir}/`) && CODE_EXT.test(p));
  const boundaries = new Map(); // dir (relative to src/app) → file
  for (const file of appFiles) {
    const src = read(file);
    const scopes = [
      ...[...src.matchAll(/<ClientMessages\s+scope=["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...src.matchAll(/getClientMessages\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    if (!scopes.length) continue;
    const dir = path.posix.dirname(file.slice(appDir.length + 1));
    for (const scope of new Set(scopes)) {
      if (!/(?:^|\/)layout\.tsx$/.test(file)) errors.push(`${file}: client-message boundaries belong in layout.tsx files`);
      else if (scope !== dir) errors.push(`${file}: scope "${scope}" must be "${dir}" (the layout's directory under src/app)`);
      else boundaries.set(dir, file);
    }
  }

  const ancestorsOf = (dir) => {
    const out = [];
    for (let d = dir; ; d = path.posix.dirname(d)) {
      if (boundaries.has(d)) out.push(d);
      if (d === "." || !d.includes("/")) {
        if (d !== "." && boundaries.has(".")) out.push(".");
        break;
      }
    }
    return out; // nearest first
  };

  const own = new Map([...boundaries.keys()].map((d) => [d, new Set()]));
  for (const file of appFiles.filter((p) => ROUTE_FILE.test(p))) {
    const rel = file.slice(appDir.length + 1);
    const used = needs(file);
    const [nearest] = ancestorsOf(path.posix.dirname(rel));
    if (!nearest) {
      if (used.size) errors.push(`${file}: uses client messages (${[...used].join(", ")}) but no <ClientMessages> boundary encloses it`);
      continue;
    }
    for (const ns of used) own.get(nearest).add(ns);
  }

  // Subtract what enclosing boundaries provide (outermost first).
  const scopes = {};
  const provided = new Map();
  for (const dir of [...boundaries.keys()].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
    const parents = ancestorsOf(dir).slice(1);
    const inherited = new Set(parents.flatMap((p) => [...(provided.get(p) ?? [])]));
    const needed = own.get(dir);
    // A whole namespace makes its units redundant.
    const mine = [...needed].filter((u) => !covered(u, inherited) && !covered(u, new Set([...needed].filter((o) => o !== u)))).sort();
    provided.set(dir, new Set([...inherited, ...mine]));
    scopes[dir] = mine;
  }
  const sorted = Object.fromEntries(Object.keys(scopes).sort().map((k) => [k, scopes[k]]));
  const bytes = (dir) => [...provided.get(dir)].reduce((n, u) => n + (JSON.stringify(pickUnit(catalog, u)) ?? "").length, 0);
  return { manifest: { lazy: [...lazy].sort(), scopes: sorted }, errors, sizes: Object.keys(sorted).map((d) => [d, provided.get(d).size, bytes(d)]) };
}

const check = process.argv.includes("--check");
const why = process.argv.includes("--why");
const verbose = process.argv.includes("--verbose");
let failed = false;
for (const app of APPS) {
  const { manifest, errors, sizes } = analyzeApp(app);
  const file = `apps/${app}/src/i18n/client-namespaces.json`;
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  const current = fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), "utf8") : "";
  for (const e of [...new Set(errors)]) console.error(`i18n-namespaces: ${e}`);
  if (errors.length) failed = true;
  if (verbose) for (const [d, n, b] of sizes) console.log(`  ${app} ${d}: ${n} units, ${(b / 1024).toFixed(1)} KB (en-US)`);
  if (current === next) continue;
  if (check) {
    console.error(`i18n-namespaces: ${file} is stale (client components use namespaces their pages do not receive). Run: pnpm i18n:sync`);
    failed = true;
  } else {
    fs.writeFileSync(path.join(ROOT, file), next);
    console.log(`i18n-namespaces: wrote ${file}`);
  }
}
if (failed) process.exit(1);
if (check) console.log("i18n-namespaces: client message manifests up to date.");
