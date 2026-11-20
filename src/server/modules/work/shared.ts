import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, orgChain, type ScopeChain } from "@/server/modules/rbac/scope";

export type WorkPermission = "projects.read" | "projects.manage" | "operations.read" | "operations.manage";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const optDay = day.or(z.literal("")).nullable().optional();
export const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const optMoney = money.or(z.literal("")).nullable().optional();
export const optUuid = uuid.or(z.literal("")).nullable().optional();
export const optText = (max: number) => z.string().trim().max(max).nullable().optional();
export const quarter = z.string().regex(/^\d{4}-Q[1-4]$/);

export const toDay = (v?: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
export const dayString = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/** Major units string → minor units (2 decimals). */
export const toMinor = (v?: string | null) => (v ? BigInt(Math.round(Number(v) * 100)) : null);
export const blank = <T>(v: T | "" | null | undefined) => (v === "" || v === undefined ? null : v);
export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

/** Start of today (UTC date). */
export function today(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86_400_000);
}

export function addMonths(d: Date, n: number) {
  const r = new Date(d);
  const dayOfMonth = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(dayOfMonth, last));
  return r;
}

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: WorkPermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** A project of this company (not found otherwise) and its scope chain (project-scoped role grants apply). */
export async function projectScope(client: Tx | Db, organizationId: string, companyId: string, projectId: string) {
  if (!isUuid(projectId)) throw notFound("Project");
  const p = await client.project.findFirst({ where: { id: projectId, organizationId, companyId }, select: { id: true, workspaceId: true, archivedAt: true, currency: true, name: true } });
  if (!p) throw notFound("Project");
  const chain: ScopeChain = [{ type: "PROJECT", id: p.id }, { type: "WORKSPACE", id: p.workspaceId }, { type: "COMPANY", id: companyId }, ...orgChain(organizationId)];
  return { project: p, chain };
}

export async function authorizeProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, permission: "projects.read" | "projects.manage", tx?: Tx) {
  // Company first so a foreign company is not_found rather than leaking project existence.
  await companyChain(tx ?? db(), organizationId, companyId);
  const scope = await projectScope(tx ?? db(), organizationId, companyId, projectId);
  await requirePermission(ctx, permission, scope.chain, tx);
  return scope;
}

/** Active organization members who hold `permission` at this company (people pickers, assignment checks). */
export async function eligibleUserIds(client: Tx | Db, organizationId: string, chain: ScopeChain, permission: WorkPermission, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), permission, chain)) ok.push(m.userId);
  return ok;
}

export async function requireEligible(client: Tx | Db, organizationId: string, chain: ScopeChain, userId: string, permission: WorkPermission = "projects.read") {
  const [ok] = await eligibleUserIds(client, organizationId, chain, permission, [userId]);
  if (!ok) throw invalid("This person has no access to this area", { reason: "work_user_ineligible" });
}

/** People who can work in this company's projects (id + name), for pickers. */
export async function listPeople(ctx: RequestContext, organizationId: string, companyId: string, permission: WorkPermission = "projects.read") {
  const chain = await authorize(ctx, organizationId, companyId, permission);
  const ids = await eligibleUserIds(db(), organizationId, chain, permission);
  return db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** id → name for a set of user ids. */
export async function userNames(client: Tx | Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map<string, string>();
  const users = await client.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** First value of a URL search param. */
export function param(raw: Record<string, string | string[] | undefined>, key: string) {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

export function oneOf<T extends string>(values: readonly T[], v: string | undefined): T | undefined {
  return v && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}

export const PAGE_SIZE = 50;
export function pageParam(raw: Record<string, string | string[] | undefined>) {
  const n = Number(param(raw, "page") ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}
