/**
 * Credit ledger (credit_ledger_entries): a signed, append-only record of every change to an organization's metered
 * allowances — plan period grants, add-on purchases and admin grants, consumption (daily aggregates of usage_records),
 * expirations, and admin refunds / adjustments / promotions.
 *
 * Enforcement: GRANT, PURCHASE, USAGE and EXPIRY rows mirror their source of truth (plan limits, add-on purchases,
 * usage_records), which the entitlement checks already read. REFUND, ADJUSTMENT and PROMOTION rows exist only here,
 * so `ledgerAllowance` adds them to the allowance of their period (service.ts → resolve()).
 *
 * No "server-only" import: the worker writes the ledger jobs.
 */
import type { Db, Tx } from "@/server/core/db";
import { LIMITS, METER_LIMIT, isMeterKey, type LimitKey, type MeterKey } from "./catalog";

export const LEDGER_KINDS = ["GRANT", "PURCHASE", "USAGE", "EXPIRY", "REFUND", "ADJUSTMENT", "PROMOTION"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
/** Kinds that change the enforced allowance (they have no other source of truth). */
export const ALLOWANCE_KINDS: readonly LedgerKind[] = ["REFUND", "ADJUSTMENT", "PROMOTION"];
/** Kinds an admin may write by hand. */
export const ADMIN_LEDGER_KINDS = ["ADJUSTMENT", "PROMOTION", "REFUND"] as const;

export const isLedgerKind = (k: string): k is LedgerKind => (LEDGER_KINDS as readonly string[]).includes(k);

/** Metered limit keys (those with a usage meter), i.e. the ones a ledger entry can target. */
export const LEDGER_METERS = Object.keys(METER_LIMIT) as MeterKey[];
export const meterOfLimit = (limit: LimitKey): MeterKey | null => {
  const m = LIMITS[limit].meter;
  return m && isMeterKey(m) ? m : null;
};

export const periodKeyOf = (start: Date) => start.toISOString().slice(0, 10);

export interface LedgerEntryInput {
  organizationId: string;
  companyId?: string | null;
  meter: MeterKey;
  kind: LedgerKind;
  delta: bigint;
  period: { start: Date; end: Date };
  sourceType: string;
  sourceId: string;
  reason?: string | null;
  actorId?: string | null;
}

/**
 * Append one entry. Idempotent on (sourceType, sourceId, kind): a replay (webhook retry, job re-run) is a no-op and
 * returns false.
 */
export async function writeLedgerEntry(client: Db | Tx, e: LedgerEntryInput): Promise<boolean> {
  const r = await client.creditLedgerEntry.createMany({
    data: [
      {
        organizationId: e.organizationId,
        companyId: e.companyId ?? null,
        meter: e.meter,
        kind: e.kind,
        delta: e.delta,
        periodKey: periodKeyOf(e.period.start),
        periodStart: e.period.start,
        periodEnd: e.period.end,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        reason: e.reason ?? null,
        actorId: e.actorId ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return r.count === 1;
}

/** Ledger-only allowance changes (REFUND / ADJUSTMENT / PROMOTION) active at `now`, per limit key. */
export async function ledgerAllowance(client: Db | Tx, organizationId: string, now: Date): Promise<Partial<Record<LimitKey, number>>> {
  const rows = await client.creditLedgerEntry.groupBy({
    by: ["meter"],
    where: { organizationId, kind: { in: [...ALLOWANCE_KINDS] }, periodStart: { lte: now }, periodEnd: { gt: now } },
    _sum: { delta: true },
  });
  const out: Partial<Record<LimitKey, number>> = {};
  for (const r of rows) if (isMeterKey(r.meter)) out[METER_LIMIT[r.meter]] = Number(r._sum.delta ?? 0n);
  return out;
}
