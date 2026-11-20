import { z } from "zod";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { minorUnits } from "@/i18n/format";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

/** Shared helpers of the CRM services (validation, RBAC, money, owners). */

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const moneyInput = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/);
export const currencyInput = z.string().trim().regex(/^[A-Z]{3}$/);
export const blank = z.literal("").transform(() => undefined);
export const optText = (max: number) => z.string().trim().max(max).optional();
/** For PATCH: a string, or ""/null to clear. */
export const clearable = (max: number) => z.string().trim().max(max).nullable().optional();
export const tagsInput = z.array(z.string().trim().min(1).max(40)).max(30);
export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export type SalesPermission = "sales.read" | "sales.manage";

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: SalesPermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

/** "4999.50" in major units → minor units of `currency` (exact decimal arithmetic). */
export function toMinor(value: string | null | undefined, currency: string): bigint | null {
  if (value == null || value === "") return null;
  const digits = minorUnits(currency);
  const [whole, frac = ""] = value.trim().split(".");
  if (frac.length > digits) throw invalid("Too many decimals for this currency", { reason: "crm_amount_decimals" });
  return BigInt(whole || "0") * 10n ** BigInt(digits) + BigInt((frac.padEnd(digits, "0") || "0").slice(0, digits) || "0");
}

/** Minor units → "4999.5" major-unit string for form inputs. */
export function toMajor(minor: bigint | null | undefined, currency: string): string {
  if (minor == null) return "";
  const digits = minorUnits(currency);
  if (!digits) return minor.toString();
  const neg = minor < 0n;
  const s = (neg ? -minor : minor).toString().padStart(digits + 1, "0");
  const frac = s.slice(-digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${s.slice(0, -digits)}${frac ? `.${frac}` : ""}`;
}

export const toDay = (value?: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
export function toInstant(value: string) {
  const d = new Date(value.length === 10 ? `${value}T09:00:00Z` : value);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  return d;
}
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export const cleanTags = (tags?: string[] | null) => [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);

/** Users who can own CRM records at this company: active members holding sales.read there. */
export async function eligibleOwnerIds(client: Tx | Db, organizationId: string, chain: ScopeChain, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), "sales.read", chain)) ok.push(m.userId);
  return ok;
}

export async function requireOwner(tx: Tx, organizationId: string, chain: ScopeChain, ownerId: string) {
  const [ok] = await eligibleOwnerIds(tx, organizationId, chain, [ownerId]);
  if (!ok) throw invalid("This person can't own records in this company", { reason: "lead_owner_ineligible" });
}

/** id → name for user ids (owners, authors). */
export async function userNames(client: Tx | Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (!unique.length) return new Map<string, string>();
  const users = await client.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function companyCurrency(client: Tx | Db, organizationId: string, companyId: string) {
  const c = await client.company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true, timezone: true } });
  if (!c) throw notFound("Company");
  return c;
}

/** Read a single string from URL search params. */
export function param(raw: Record<string, string | string[] | undefined>, key: string, max = 200) {
  const v = raw[key];
  return ((Array.isArray(v) ? v[0] : v)?.trim() || undefined)?.slice(0, max);
}

export function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

/** Offset pagination for list pages: page (1-based) and size. */
export function pageOf(raw: Record<string, string | string[] | undefined>, size = 50) {
  const page = Math.max(1, Math.min(10_000, Number(param(raw, "page")) || 1));
  return { page, size, skip: (page - 1) * size };
}

/** Case-insensitive contains filter. */
export const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });
