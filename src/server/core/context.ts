import { randomUUID } from "node:crypto";
import type { ActorType } from "@/generated/prisma/enums";

export interface Actor {
  type: ActorType;
  id: string | null;
}

/**
 * Everything a domain service needs to know about who is acting. Services authorize against this —
 * never against ids the client supplied.
 */
export interface RequestContext {
  requestId: string;
  actor: Actor;
  /** When the session last completed MFA (users only). */
  mfaVerifiedAt: Date | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

export function newRequestId(incoming?: string | null): string {
  return incoming && REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID()}`;
}

export function systemContext(requestId?: string): RequestContext {
  return {
    requestId: newRequestId(requestId),
    actor: { type: "SYSTEM", id: null },
    mfaVerifiedAt: null,
    sessionId: null,
    ip: null,
    userAgent: null,
  };
}

export function userContext(
  userId: string,
  opts: Partial<Omit<RequestContext, "actor">> = {},
): RequestContext {
  return {
    requestId: newRequestId(opts.requestId),
    actor: { type: "USER", id: userId },
    mfaVerifiedAt: opts.mfaVerifiedAt ?? null,
    sessionId: opts.sessionId ?? null,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  };
}
