import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { randomToken } from "@/server/core/crypto";
import { assertModuleEnabled } from "@/server/core/platform-controls";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

/**
 * Website live chat. Inbox access reuses the support permissions: support.read (see conversations, analytics) and
 * support.manage (reply, take over, settings, delete visitor data). Every query is scoped by organizationId + companyId.
 */
export type LivechatPermission = "support.read" | "support.manage";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;

export const STATUSES = ["AI_ACTIVE", "WAITING_HUMAN", "HUMAN_ACTIVE", "CLOSED"] as const;
/** Outcome tags set automatically (lead, ticket, meeting, handoff, answered, knowledge_gap) or by people in the inbox. */
export const OUTCOMES = ["answered", "lead", "ticket", "meeting", "handoff", "knowledge_gap", "spam", "resolved", "follow_up"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** An AI-active conversation with no message for this long is closed by the worker (and counted as AI-resolved or not). */
export const IDLE_CLOSE_MS = 30 * 60_000;
/** A visitor message gets an AI reply at most this long after the claim (then another request may claim it). */
export const AI_CLAIM_MS = 60_000;

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: LivechatPermission, tx?: Tx) {
  // Live chat belongs to the support area: it follows the platform's support module switch (Admin → Platform Controls).
  await assertModuleEnabled(organizationId, "support");
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain);
  return chain;
}

export const newPublicKey = () => `lc_${randomToken(18).replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;

/** The company's settings row, created (disabled, with a fresh key) on first use. */
export async function ensureSettings(client: Tx | Db, organizationId: string, companyId: string) {
  const existing = await client.livechatSettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  return client.livechatSettings.upsert({ where: { companyId }, update: {}, create: { companyId, organizationId, publicKey: newPublicKey() } });
}

/** "https://Example.com/path" → "https://example.com"; null when not an http(s) origin. */
export function normalizeOrigin(raw: string): string | null {
  const v = raw.trim();
  const wildcard = /^(https?):\/\/\*\.([a-z0-9.-]+)(:\d+)?\/?$/i.exec(v);
  if (wildcard) return `${wildcard[1]!.toLowerCase()}://*.${wildcard[2]!.toLowerCase()}${wildcard[3] ?? ""}`;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Does `origin` (from the Origin header) match one of the allowed entries (exact, or "*.domain" for subdomains)? */
export function originAllowed(origin: string | null, allowed: string[], appOrigin: string): boolean {
  if (!origin) return false;
  const o = origin.toLowerCase();
  // The app itself (settings preview) may always load the widget.
  if (o === appOrigin.toLowerCase()) return true;
  for (const entry of allowed) {
    if (entry === o) return true;
    const m = /^(https?):\/\/\*\.(.+)$/.exec(entry);
    if (m) {
      try {
        const u = new URL(o);
        const host = u.host;
        if (u.protocol === `${m[1]}:` && (host === m[2] || host.endsWith(`.${m[2]}`))) return true;
      } catch {
        /* not a URL */
      }
    }
  }
  return false;
}

export const BRAND_COLOR = /^#[0-9a-fA-F]{6}$/;

export const addOutcome = (outcomes: string[], ...add: string[]) => [...new Set([...outcomes, ...add])].slice(0, 20);

export const conversationHref = (id: string) => `/livechat/${id}`;
