import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

export type CommsPermission = "communication.read" | "communication.post" | "communication.manage";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const instant = z.string().datetime({ offset: true });

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: CommsPermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** The acting user's id; system actors have none. */
export function actorId(ctx: RequestContext, fallback: string): string {
  return ctx.actor.id ?? fallback;
}

export function requireUserId(ctx: RequestContext): string {
  if (!ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  return ctx.actor.id;
}

/** Active members of the organization holding `permission` at the company (optionally limited to candidates). */
export async function membersWith(client: Tx | Db, organizationId: string, chain: ScopeChain, permission: string, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), permission, chain)) ok.push(m.userId);
  return ok;
}

/** People in the company's communication space (id, name, email), for pickers and @mentions. */
export async function listPeople(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  const ids = await membersWith(db(), organizationId, chain, "communication.read");
  return db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
}

/** Map of user id → display name. */
export async function userNames(client: Tx | Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (!unique.length) return new Map<string, string>();
  const users = await client.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * @mentions in text: "@[Name](uuid)" tokens written by the mention picker. Only ids of people who can read
 * communication at the company are returned (others are ignored, never notified).
 */
export async function resolveMentions(client: Tx | Db, organizationId: string, chain: ScopeChain, text: string, extra: string[] = []) {
  const ids = new Set(extra.filter(isUuid));
  for (const m of text.matchAll(/@\[[^\]]{1,120}\]\(([0-9a-f-]{36})\)/gi)) ids.add(m[1]!.toLowerCase());
  if (!ids.size) return [];
  return membersWith(client, organizationId, chain, "communication.read", [...ids]);
}

export const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mentions rendered as plain "@Name" (for notifications, external posts and AI context). */
export const plainMentions = (s: string) => s.replace(/@\[([^\]]{1,120})\]\([0-9a-f-]{36}\)/gi, "@$1");
