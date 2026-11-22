import type { ProcessApp } from "../observability";
import { installB } from "./b";
import { installE } from "./e";
import { installF } from "./f";

/**
 * Hook installers, one per stream (docs/admin/hooks.md). Each stream edits only its own file; this list is owned by
 * stream E. `installHooks` runs once per process: lazily from core/http.ts on the first API request of a web app, and
 * from the worker entry point at start ("worker": no HTTP hooks there, only job-failure and log hooks).
 */
const INSTALLERS: ((app: ProcessApp) => Promise<void> | void)[] = [installB, installE, installF];

const store = globalThis as unknown as { realyHooksInstalled?: Set<ProcessApp> };

export async function installHooks(app: ProcessApp): Promise<void> {
  store.realyHooksInstalled ??= new Set();
  if (store.realyHooksInstalled.has(app)) return;
  store.realyHooksInstalled.add(app);
  for (const install of INSTALLERS) {
    try {
      await install(app);
    } catch {
      // One stream's installer must never block another's (or the request).
    }
  }
}
