import { db, Prisma } from "./db";
import { AppError } from "./errors";
import { sha256 } from "./crypto";
import { toJson } from "./json";

/**
 * Request idempotency (docs/api.md §2). Keys are scoped by principal + endpoint ("METHOD /template"),
 * so one key can never replay a different action or another principal's request.
 *
 * Lifecycle: IN_PROGRESS row claimed via a unique index (concurrent duplicates lose the race and get
 * 409 idempotency_in_progress) → COMPLETED with the stored 2xx response, replayed for 24 h.
 * Failed requests release the key (their transaction rolled back), so the client can retry.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,255}$/;

export type IdempotencyClaim =
  | { kind: "new"; id: string }
  | { kind: "replay"; status: number; body: unknown };

export function requestHash(method: string, path: string, rawBody: string): string {
  return sha256(`${method}\n${path}\n${rawBody}`);
}

export async function claimIdempotencyKey(args: {
  principalId: string;
  endpoint: string;
  key: string;
  requestHash: string;
}): Promise<IdempotencyClaim> {
  if (!KEY_RE.test(args.key)) {
    throw new AppError("validation_error", "Idempotency-Key must be 8–255 characters of [A-Za-z0-9_-:.]");
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const row = await db().idempotencyKey.create({
        data: {
          principalId: args.principalId,
          endpoint: args.endpoint,
          key: args.key,
          requestHash: args.requestHash,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        select: { id: true },
      });
      return { kind: "new", id: row.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    }
    const existing = await db().idempotencyKey.findUnique({
      where: { principalId_endpoint_key: { principalId: args.principalId, endpoint: args.endpoint, key: args.key } },
    });
    if (!existing) continue; // released between our insert and read; retry once
    if (existing.expiresAt <= new Date()) {
      await db().idempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: new Date() } } });
      continue;
    }
    if (existing.requestHash !== args.requestHash) {
      throw new AppError("idempotency_conflict", "This Idempotency-Key was already used with a different request");
    }
    if (existing.status === "COMPLETED" && existing.responseStatus !== null) {
      return { kind: "replay", status: existing.responseStatus, body: existing.responseBody };
    }
    throw new AppError("idempotency_in_progress", "A request with this Idempotency-Key is still being processed");
  }
  throw new AppError("idempotency_in_progress", "A request with this Idempotency-Key is still being processed");
}

export async function completeIdempotencyKey(id: string, status: number, body: unknown) {
  await db().idempotencyKey.update({
    where: { id },
    data: { status: "COMPLETED", responseStatus: status, responseBody: toJson(body), completedAt: new Date() },
  });
}

export async function releaseIdempotencyKey(id: string) {
  await db().idempotencyKey.deleteMany({ where: { id, status: "IN_PROGRESS" } });
}

/** Maintenance: delete expired keys (run by the worker). */
export async function purgeExpiredIdempotencyKeys(now = new Date()): Promise<number> {
  const r = await db().idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } });
  return r.count;
}
