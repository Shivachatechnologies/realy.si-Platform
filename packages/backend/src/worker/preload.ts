/**
 * Worker preload — MUST be the first import of src/worker/index.ts.
 *
 * Server modules start with `import "server-only"`. Next resolves that marker with the `react-server` export
 * condition (an empty module); plain Node — the worker runs under tsx — takes the `default` condition, whose file
 * throws "This module cannot be imported from a Client Component module". The worker is server code by definition,
 * so here (and only here: the web apps never import this file) `server-only` is redirected to the package's own
 * empty module, for both `require()` (tsx compiles the worker to CommonJS) and ESM `import` (module.registerHooks).
 *
 * Likewise the app-provided `@/i18n/server` (each Next app maps it to its own file; it reads the `[locale]` root
 * param through `next/root-params`, which does not exist here) is redirected to ./i18n-server.ts.
 */
import Module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER = "server-only";
const emptyFor = (indexFile: string) => path.join(path.dirname(indexFile), "empty.js");
const I18N_SERVER = "@/i18n/server";
// tsx runs this package as CommonJS (no "type": "module"), so __dirname is defined.
const i18nServerFile = path.join(__dirname, "i18n-server.ts");

type ResolveFilename = (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
const mod = Module as unknown as { _resolveFilename: ResolveFilename; registerHooks?: (hooks: unknown) => unknown };
const flag = Symbol.for("realy.worker.serverOnlyShim");
const state = globalThis as unknown as Record<symbol, boolean>;

if (!state[flag]) {
  state[flag] = true;

  // CommonJS (tsx's default for this package): wrap whatever resolver is installed (tsx's own included).
  const original = mod._resolveFilename;
  mod._resolveFilename = function (request, parent, isMain, options) {
    if (request === I18N_SERVER) return original.call(this, i18nServerFile, parent, isMain, options);
    const resolved = original.call(this, request, parent, isMain, options);
    return request === MARKER ? emptyFor(resolved) : resolved;
  };

  // ESM imports (and require on Node versions where the hooks also cover it). Synchronous, in-thread hooks:
  // Node >= 22.15 / 23.5. Older Nodes only get the CommonJS patch above, which is what tsx uses here.
  if (typeof mod.registerHooks === "function") {
    mod.registerHooks({
      resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => { url: string }) {
        if (specifier === I18N_SERVER) return next(pathToFileURL(i18nServerFile).href, context);
        const result = next(specifier, context);
        if (specifier !== MARKER || !result.url.startsWith("file:")) return result;
        return { ...result, url: pathToFileURL(emptyFor(fileURLToPath(result.url))).href };
      },
    });
  }
}

export {};
