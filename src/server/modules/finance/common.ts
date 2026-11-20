import { z } from "zod";
import type { FinanceSequenceKind } from "@/generated/prisma/enums";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { minorUnits } from "@/i18n/format";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

export type FinancePermission = "finance.read" | "finance.manage" | "finance.transfer";

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Major units as typed by a person ("1234.56", "-20"). Converted exactly to minor units with `toMinor`. */
export const amount = z.string().trim().regex(/^-?\d{1,13}(\.\d{1,3})?$/, "Enter an amount like 1234.56");
export const positiveAmount = amount.refine((v) => !v.startsWith("-") && /[1-9]/.test(v), "Must be greater than zero");
export const optionalUuid = uuid.nullable().optional().or(z.literal("").transform(() => null));
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const bps = z.number().int().min(-1_000_000).max(1_000_000);
export const percentBps = z.number().int().min(0).max(10_000);

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: FinancePermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

export async function companyInfo(client: Tx | Db, organizationId: string, companyId: string) {
  const c = await client.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true, name: true, legalName: true, baseCurrency: true, timezone: true, defaultLocale: true } });
  if (!c) throw notFound("Company");
  return c;
}

/** "12.5" → 1250n for a 2-decimal currency; exact (string arithmetic), rejects more decimals than the currency has. */
export function toMinor(value: string, currency: string): bigint {
  const digits = minorUnits(currency);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw invalid("Invalid amount", { reason: "finance_invalid_amount" });
  const frac = m[3] ?? "";
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) throw invalid("Too many decimals for the currency", { reason: "finance_invalid_amount" });
  const v = BigInt(m[2] + frac.slice(0, digits).padEnd(digits, "0"));
  return m[1] ? -v : v;
}

/** 1250n → "12.50" (for form defaults and CSV). */
export function fromMinor(value: bigint, currency: string): string {
  const digits = minorUnits(currency);
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(digits + 1, "0");
  return `${neg ? "-" : ""}${digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s}`;
}

/** "12.5" (percent) → 1250 bps. */
export function percentToBps(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw invalid("Invalid percentage");
  return Math.round(n * 100);
}

export const toDay = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  return d;
};
export const dayString = (d: Date) => d.toISOString().slice(0, 10);
export const todayUtc = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const addMonths = (d: Date, n: number) => {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return r;
};
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Next occurrence after `d` for a recurrence frequency. */
export function advance(d: Date, frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY"): Date {
  if (frequency === "WEEKLY") return addDays(d, 7);
  return addMonths(d, frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12);
}
/** Occurrences per month, for MRR and forecasts. */
export const PER_MONTH = { WEEKLY: 52 / 12, MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12 } as const;

/** Next number of a per-company sequence (row-locked by the upsert's update). */
export async function nextSequence(tx: Tx, organizationId: string, companyId: string, kind: FinanceSequenceKind): Promise<number> {
  const row = await tx.financeSequence.upsert({
    where: { companyId_kind: { companyId, kind } },
    create: { organizationId, companyId, kind, next: 2 },
    update: { next: { increment: 1 } },
    select: { next: true },
  });
  return row.next - 1;
}

export async function financeSettings(client: Tx | Db, organizationId: string, companyId: string) {
  return (
    (await client.financeSettings.findUnique({ where: { companyId } })) ?? {
      id: null,
      organizationId,
      companyId,
      invoicePrefix: "INV-",
      estimatePrefix: "EST-",
      creditNotePrefix: "CN-",
      defaultDueDays: 30,
      invoiceFooter: null,
    }
  );
}

/** Values from the URL: first value, trimmed; empty → undefined. */
export function param(raw: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

export interface DateRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive end in the URL); defaults to the last `defaultMonths` whole months + this month. */
export function parseRange(raw: Record<string, string | string[] | undefined>, defaultMonths = 12, now = new Date()): DateRange & { fromStr: string; toStr: string } {
  const f = param(raw, "from");
  const t = param(raw, "to");
  const okF = f && day.safeParse(f).success ? toDay(f) : null;
  const okT = t && day.safeParse(t).success ? toDay(t) : null;
  const to = okT ? addDays(okT, 1) : addDays(todayUtc(now), 1);
  let from = okF ?? addMonths(monthStart(todayUtc(now)), -(defaultMonths - 1));
  if (from >= to) from = addMonths(monthStart(addDays(to, -1)), -(defaultMonths - 1));
  return { from, to, fromStr: dayString(from), toStr: dayString(addDays(to, -1)) };
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const sumMinor = <T>(items: T[], f: (x: T) => bigint) => items.reduce((s, x) => s + f(x), 0n);
export const PAGE_SIZE = 50;
export function pageParam(raw: Record<string, string | string[] | undefined>) {
  const n = Number(param(raw, "page") ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}
