import type { Tx, Db } from "@/server/core/db";
import { db } from "@/server/core/db";
import { randomToken, sha256 } from "@/server/core/crypto";

export const SESSION_COOKIE = "realy_session";
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionInfo {
  id: string;
  userId: string;
  mfaPending: boolean;
  mfaVerifiedAt: Date | null;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

/** Create a session; returns the raw token (cookie value). Only its SHA-256 is stored. */
export async function createSession(
  client: Tx | Db,
  userId: string,
  opts: { mfaPending: boolean; mfaVerifiedAt?: Date | null; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; session: SessionInfo }> {
  const token = randomToken(32);
  const s = await client.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      mfaPending: opts.mfaPending,
      mfaVerifiedAt: opts.mfaVerifiedAt ?? null,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 512) ?? null,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
    },
  });
  return { token, session: toInfo(s) };
}

function toInfo(s: {
  id: string;
  userId: string;
  mfaPending: boolean;
  mfaVerifiedAt: Date | null;
  activeOrganizationId: string | null;
  expiresAt: Date;
}): SessionInfo {
  return {
    id: s.id,
    userId: s.userId,
    mfaPending: s.mfaPending,
    mfaVerifiedAt: s.mfaVerifiedAt,
    activeOrganizationId: s.activeOrganizationId,
    expiresAt: s.expiresAt,
  };
}

/** Resolve a raw token to a live session (not revoked, not expired, not idle, user active). */
export async function validateSessionToken(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token || token.length > 128) return null;
  const s = await db().session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { status: true } } },
  });
  if (!s || s.revokedAt || s.user.status !== "ACTIVE") return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || now - s.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now) } });
  }
  return toInfo(s);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db().session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(client: Tx | Db, userId: string, exceptSessionId?: string): Promise<void> {
  await client.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});
