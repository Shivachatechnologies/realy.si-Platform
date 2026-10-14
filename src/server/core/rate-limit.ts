import { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    // Commands queue briefly while connecting; commandTimeout bounds the wait so a down Redis fails fast.
    client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 750 });
    client.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  }
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Fixed-window counter in Redis (INCR + PEXPIRE, atomic via MULTI). Fails open if Redis is
 * unreachable — availability of sign-in must not depend on the limiter — and logs the degradation.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const resetSeconds = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);
  try {
    const res = await redis().multi().incr(bucket).pexpire(bucket, windowMs).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, "rate limiter unavailable; failing open");
    return { allowed: true, limit, remaining: limit, resetSeconds };
  }
}
