import { decryptSecret } from "./crypto";
import { db } from "./db";
import { env, resetEnvCache } from "./env";
import { logger } from "./logger";
import { isPlatformKey, platformKeyDef } from "./platform-secrets-catalog";

/**
 * Runtime overlay of platform keys set in Admin → Settings → Platform keys (docs/platform-keys.md).
 *
 * Rows of `platform_secrets` are decrypted and written onto process.env, so every existing `env()` / process.env
 * reader picks them up without changes. A DB value wins over the host env; deleting the row restores the host value
 * (snapshotted before the first override). Values are never logged — only key names.
 *
 * Freshness: ensurePlatformSecretsFresh() reloads at most every TTL_MS (single-flight, never throws) and is called
 * from instrumentation register(), route(), getSession() and the worker, so serverless instances converge within
 * ~30 s of a change. The instance that made the change reloads immediately (loadPlatformSecrets()).
 */

export const PLATFORM_SECRET_PURPOSE = "platform-secret";
const TTL_MS = 30_000;
const ERROR_BACKOFF_MS = 10_000;

interface OverlayState {
  /** Host env value of every key we have ever overridden (undefined = was not set). */
  original: Map<string, string | undefined>;
  /** Keys currently overridden from the DB → the value we wrote. */
  applied: Map<string, string>;
  loadedAt: number;
  inflight: Promise<void> | null;
  warnedMissingTable: boolean;
}

// On globalThis so every copy of this module (route bundles, HMR) shares one overlay.
const g = globalThis as unknown as { realyPlatformSecrets?: OverlayState };
const state: OverlayState = (g.realyPlatformSecrets ??= { original: new Map(), applied: new Map(), loadedAt: 0, inflight: null, warnedMissingTable: false });

/** The host-environment value of a key, ignoring any admin override. */
export function hostEnvValue(key: string): string | undefined {
  const v = state.original.has(key) ? state.original.get(key) : process.env[key];
  return v && v.trim() ? v : undefined;
}

/** True when the key's current value comes from the admin (DB) rather than the host env. */
export const isOverridden = (key: string) => state.applied.has(key);

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Apply `next` (key → plaintext) as the complete overlay. Returns true when process.env changed. */
function applyOverlay(next: Map<string, string>): boolean {
  let changed = false;
  for (const [key] of state.applied) {
    if (next.has(key)) continue;
    setEnv(key, state.original.get(key));
    state.applied.delete(key);
    changed = true;
  }
  for (const [key, value] of next) {
    if (state.applied.get(key) === value) continue;
    if (!state.original.has(key)) state.original.set(key, process.env[key]);
    process.env[key] = value;
    state.applied.set(key, value);
    changed = true;
  }
  return changed;
}

function isMissingTable(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * Read every platform key from the database and overlay it onto process.env, then invalidate env()'s cache.
 * Throws on database errors (ensurePlatformSecretsFresh() swallows them); the previous overlay is kept.
 */
export async function loadPlatformSecrets(): Promise<{ applied: number; changed: boolean }> {
  if (!process.env.DATABASE_URL) return { applied: 0, changed: false };
  const rows = await db().platformSecret.findMany({ select: { key: true, valueEncrypted: true } });
  const next = new Map<string, string>();
  for (const row of rows) {
    if (!isPlatformKey(row.key)) continue; // never overlay anything outside the allow-list
    try {
      const value = decryptSecret(row.valueEncrypted, PLATFORM_SECRET_PURPOSE);
      const def = platformKeyDef(row.key)!;
      if (def.validate(value, (k) => next.get(k) ?? process.env[k]) !== null) {
        logger.warn({ key: row.key }, "platform key ignored: stored value fails validation");
        continue;
      }
      next.set(row.key, value);
    } catch {
      logger.warn({ key: row.key }, "platform key ignored: cannot decrypt (was REALY_ENCRYPTION_KEY rotated?)");
    }
  }
  const previous = new Map(state.applied);
  const prevLogLevel = process.env.LOG_LEVEL;
  const changed = applyOverlay(next);
  if (changed) {
    resetEnvCache();
    try {
      env();
    } catch (err) {
      // A stored value makes the environment invalid: never take the process down for it — roll back.
      applyOverlay(previous);
      resetEnvCache();
      // env() errors name the variable and the rule, never the value.
      logger.error({ err: err instanceof Error ? err.message.slice(0, 300) : "invalid" }, "platform keys rejected: environment would be invalid");
      throw err;
    }
    if (process.env.LOG_LEVEL !== prevLogLevel) {
      const level = process.env.LOG_LEVEL ?? "info";
      if (["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(level)) logger.level = level;
    }
    logger.info({ keys: [...state.applied.keys()] }, "platform keys applied");
  }
  state.loadedAt = Date.now();
  return { applied: state.applied.size, changed };
}

/**
 * Reload platform keys when the last load is older than ~30 s. Single-flight; never throws — on a database error the
 * last known values stay in place and the error is logged (key names only). Cheap when fresh (no I/O).
 */
export function ensurePlatformSecretsFresh(): Promise<void> {
  if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) return Promise.resolve();
  if (Date.now() - state.loadedAt < TTL_MS) return Promise.resolve();
  if (state.inflight) return state.inflight;
  state.inflight = loadPlatformSecrets()
    .then(() => undefined)
    .catch((err: unknown) => {
      state.loadedAt = Date.now() - TTL_MS + ERROR_BACKOFF_MS;
      if (isMissingTable(err)) {
        if (!state.warnedMissingTable) logger.warn("platform_secrets table missing: run migrations; using host env only");
        state.warnedMissingTable = true;
        return;
      }
      logger.warn({ err: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "platform keys refresh failed; keeping last values");
    })
    .finally(() => {
      state.inflight = null;
    });
  return state.inflight;
}

/** Force the next ensurePlatformSecretsFresh() to reload (after an admin change on another code path). */
export function markPlatformSecretsStale() {
  state.loadedAt = 0;
}

/** Short non-reversible fingerprint used by lazily-built clients to notice a rotated key. */
export function keyFingerprint(value: string | undefined): string {
  if (!value) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return `${value.length}:${(h >>> 0).toString(36)}`;
}
