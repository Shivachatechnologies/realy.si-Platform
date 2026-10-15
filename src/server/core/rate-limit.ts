import { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";
import { securityEvent } from "./telemetry";

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    // Commands queue briefly while connecting; commandTimeout bounds the wait so a down Redis fails fast.
    client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 750 });
    client.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  }
  return client;
}

export interface RateLimitRule {
  /** Stable bucket name, e.g. "sign-in:ip". */
  name: string;
  limit: number;
  windowMs: number;
  /**
   * Sensitive buckets (authentication, MFA, password reset) fail CLOSED in production when the limiter
   * store is unavailable; everything else fails open. See docs/security.md §7.
   */
  sensitive?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets. */
  resetSeconds: number;
  /** True when the decision was made without the shared store (fallback or fail-closed). */
  degraded: boolean;
}

// Sliding-window counter: count(current window) + count(previous window) × overlap fraction.
// Two keys per subject; works across any number of app instances because state lives in Redis.
const SCRIPT = `
local cur = redis.call('INCR', KEYS[1])
if cur == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
return {cur, prev}
`;

const memory = new Map<string, { count: number; expiresAt: number }>();

/** Per-process fallback used only outside production when Redis is unavailable. */
function memoryIncr(key: string, ttlMs: number): number {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + ttlMs });
    if (memory.size > 50_000) for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function evaluate(rule: RateLimitRule, cur: number, prev: number, now: number, degraded: boolean): RateLimitResult {
  const elapsed = (now % rule.windowMs) / rule.windowMs;
  const estimated = Math.floor(prev * (1 - elapsed)) + cur;
  return {
    allowed: estimated <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - estimated),
    resetSeconds: Math.max(1, Math.ceil((rule.windowMs - (now % rule.windowMs)) / 1000)),
    degraded,
  };
}

/** Count one hit for `subject` against `rule`. `subject` must not contain secrets (hash emails etc.). */
export async function consume(rule: RateLimitRule, subject: string, now = Date.now()): Promise<RateLimitResult> {
  const window = Math.floor(now / rule.windowMs);
  const cur = `rl:${rule.name}:${subject}:${window}`;
  const prev = `rl:${rule.name}:${subject}:${window - 1}`;
  try {
    const [c, p] = (await redis().eval(SCRIPT, 2, cur, prev, String(rule.windowMs * 2))) as [number, number];
    return evaluate(rule, Number(c), Number(p), now, false);
  } catch (err) {
    const production = env().NODE_ENV === "production";
    if (production && rule.sensitive) {
      securityEvent("rate_limit.store_unavailable", { rule: rule.name, mode: "fail_closed" });
      logger.error({ err: (err as Error).message, rule: rule.name }, "rate limiter unavailable; failing closed");
      return { allowed: false, limit: rule.limit, remaining: 0, resetSeconds: 30, degraded: true };
    }
    if (production) {
      logger.warn({ err: (err as Error).message, rule: rule.name }, "rate limiter unavailable; failing open");
      return { allowed: true, limit: rule.limit, remaining: rule.limit, resetSeconds: 0, degraded: true };
    }
    // Development/test: per-process fallback keeps limits meaningful on a single instance.
    return evaluate(rule, memoryIncr(cur, rule.windowMs * 2), memory.get(prev)?.count ?? 0, now, true);
  }
}

/** Standard headers (IETF RateLimit header fields draft, delta-seconds) for the most restrictive result. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.resetSeconds),
  };
  if (!r.allowed) h["Retry-After"] = String(r.resetSeconds);
  return h;
}

/** Most restrictive of several results (denied first, then fewest remaining). */
export function mostRestrictive(results: RateLimitResult[]): RateLimitResult | null {
  if (results.length === 0) return null;
  return [...results].sort((a, b) => Number(a.allowed) - Number(b.allowed) || a.remaining - b.remaining)[0]!;
}

/** Test hook. */
export function resetMemoryLimiter() {
  memory.clear();
}
