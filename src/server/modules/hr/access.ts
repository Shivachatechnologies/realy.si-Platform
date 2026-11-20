import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { minorUnits } from "@/i18n/format";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

/** Shared helpers of the HR module: validation primitives, authorization and "who am I as an employee". */

export type HrPermission = "hr.read" | "hr.manage" | "payroll.read" | "payroll.manage" | "users.read";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/);
export const blank = z.literal("").transform(() => undefined);
/** Optional text that treats "" as absent. */
export const optText = (max: number) => z.string().trim().max(max).optional().or(blank);
/** Patch text: "" or null clears. */
export const patchText = (max: number) => z.string().trim().max(max).nullable().optional();

export const toDay = (v?: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
export const dayString = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
export const todayUtc = () => toDay(new Date().toISOString().slice(0, 10))!;

/** "1234.5" (major units) → minor units of `currency` without floating point. */
export function toMinor(value: string | null | undefined, currency: string): bigint | null {
  if (value == null || value === "") return null;
  const digits = minorUnits(currency);
  const [int, frac = ""] = value.split(".");
  if (frac.length > digits) throw invalid("Too many decimal places for the currency");
  return BigInt(int!) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
}

/** Minor units → "1234.50" for form inputs. */
export function toMajor(minor: bigint | null | undefined, currency: string): string {
  if (minor == null) return "";
  const digits = minorUnits(currency);
  if (!digits) return minor.toString();
  const neg = minor < 0n;
  const s = (neg ? -minor : minor).toString().padStart(digits + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: HrPermission, tx?: Tx | Db): Promise<ScopeChain> {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export const actorId = (ctx: RequestContext, fallback: string) => ctx.actor.id ?? fallback;

/** The employee record linked to the acting user in this company (null for agents/system or unlinked users). */
export async function myEmployee(client: Tx | Db, ctx: RequestContext, organizationId: string, companyId: string) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) return null;
  return client.employee.findFirst({ where: { organizationId, companyId, userId: ctx.actor.id, archivedAt: null } });
}

/** What the viewer may do in HR at this company (UI hints; services enforce on their own). */
export async function hrAccess(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  const [read, manage, payrollRead, payrollManage, usersRead, agentsRun] = await Promise.all([
    can(ctx, "hr.read", chain),
    can(ctx, "hr.manage", chain),
    can(ctx, "payroll.read", chain),
    can(ctx, "payroll.manage", chain),
    can(ctx, "users.read", chain),
    can(ctx, "agents.run", chain),
  ]);
  const me = read || manage ? await myEmployee(db(), ctx, organizationId, companyId) : null;
  return { chain, read: read || manage, manage, payrollRead: payrollRead || payrollManage, payrollManage, usersRead, agentsRun, me };
}
export type HrAccess = Awaited<ReturnType<typeof hrAccess>>;

export async function requireEmployee(client: Tx | Db, organizationId: string, companyId: string, employeeId: string, opts: { includeArchived?: boolean } = {}) {
  if (!isUuid(employeeId)) throw notFound("Employee");
  const e = await client.employee.findFirst({ where: { id: employeeId, organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) } });
  if (!e) throw notFound("Employee");
  return e;
}

/** Throws unless every id is an employee of the company. */
export async function requireEmployees(client: Tx | Db, organizationId: string, companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const n = await client.employee.count({ where: { id: { in: unique }, organizationId, companyId, archivedAt: null } });
  if (n !== unique.length) throw invalid("Unknown employee", { reason: "hr_unknown_employee" });
}

/** Is `managerEmployeeId` somewhere above `employeeId` in the reporting line? */
export async function isInReportingLine(client: Tx | Db, companyId: string, employeeId: string, managerEmployeeId: string) {
  let current: string | null = employeeId;
  for (let depth = 0; current && depth < 50; depth++) {
    const row: { managerId: string | null } | null = await client.employee.findFirst({ where: { id: current, companyId }, select: { managerId: true } });
    current = row?.managerId ?? null;
    if (current === managerEmployeeId) return true;
  }
  return false;
}

export const employeeName = (e: { firstName: string; lastName: string | null }) => [e.firstName, e.lastName].filter(Boolean).join(" ");

/** Parse a string URL param list into a typed filter value (unknown values are ignored). */
export function oneParam(raw: Record<string, string | string[] | undefined>, key: string, max = 200) {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;
}
export function enumParam<T extends string>(raw: Record<string, string | string[] | undefined>, key: string, values: readonly T[]): T | undefined {
  const v = oneParam(raw, key);
  return (values as readonly string[]).includes(v ?? "") ? (v as T) : undefined;
}
export function pageParam(raw: Record<string, string | string[] | undefined>) {
  const n = Number(oneParam(raw, "page") ?? "1");
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}
