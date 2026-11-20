import { z } from "zod";
import { db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

export const uuid = z.string().uuid();
export const isUuid = (v: string | null | undefined) => !!v && uuid.safeParse(v).success;
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const blank = z.literal("").transform(() => undefined);
export const instant = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/));

export type MarketingPermission = "marketing.read" | "marketing.manage";

/** Authorize at the company (inside the transaction for writes). Foreign companies resolve to not_found. */
export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: MarketingPermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;
export const toMinor = (value?: string | null) => (value ? BigInt(Math.round(Number(value) * 100)) : null);
export const toDay = (value?: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
export const toInstant = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const normalizeEmail = (email: string | null | undefined) => (email ? email.trim().toLowerCase() : null) || null;

/** Ensures an optional id points at a row of this company; returns the id (or null). */
export async function requireOwned(
  tx: Tx,
  model: "marketingCampaign" | "marketingSegment" | "marketingContent" | "marketingEmailTemplate" | "marketingForm" | "marketingSequence",
  companyId: string,
  id: string | null | undefined,
  what: string,
): Promise<string | null> {
  if (!id) return null;
  if (!isUuid(id)) throw notFound(what);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (tx[model] as any).findFirst({ where: { id, companyId }, select: { id: true } });
  if (!row) throw notFound(what);
  return id;
}

/** Search-param helpers for list pages (unknown values are ignored, never rejected). */
export function param(raw: Record<string, string | string[] | undefined>, key: string, max = 200): string | undefined {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;
}
export function enumParam<T extends string>(raw: Record<string, string | string[] | undefined>, key: string, values: readonly T[]): T | undefined {
  const v = param(raw, key);
  return v && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}
export function pageParam(raw: Record<string, string | string[] | undefined>): number {
  const n = Number(param(raw, "page") ?? "1");
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}
export const PAGE_SIZE = 25;

/** Fill {{tag}} merge tags; unknown tags render empty. */
export function renderMergeTags(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

export const CHANNELS = [
  "email",
  "linkedin",
  "x",
  "instagram",
  "facebook",
  "seo",
  "content",
  "google_ads",
  "meta_ads",
  "events",
  "referral",
  "other",
] as const;
export type Channel = (typeof CHANNELS)[number];
