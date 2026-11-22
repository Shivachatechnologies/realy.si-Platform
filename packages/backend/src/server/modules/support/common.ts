import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const blank = z.literal("").transform(() => undefined);

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const STATUSES = ["NEW", "OPEN", "PENDING", "ON_HOLD", "SOLVED", "CLOSED"] as const;
export const CHANNELS = ["WEB", "EMAIL", "CHAT", "PHONE", "WHATSAPP"] as const;
export const OPEN_STATUSES = ["NEW", "OPEN", "PENDING", "ON_HOLD"] as const;

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "support.read" | "support.manage", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** Active organization members holding support.read at the company: who tickets can be assigned to. */
export async function supportAgents(client: Tx | Db, organizationId: string, chain: ScopeChain, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), "support.read", chain)) ok.push(m.userId);
  return ok;
}

export async function requireAgent(client: Tx | Db, organizationId: string, chain: ScopeChain, userId: string) {
  const [ok] = await supportAgents(client, organizationId, chain, [userId]);
  if (!ok) throw invalid("This person can't handle support tickets in this company", { reason: "support_assignee_ineligible" });
}

/** Agents (id + name) for pickers. */
export async function listAgents(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "support.read");
  const ids = await supportAgents(db(), organizationId, chain);
  return db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function userNames(client: Tx | Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (!unique.length) return new Map<string, string>();
  const users = await client.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export const normalizeEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);
export const contactName = (c: { firstName: string; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ");
