/**
 * Credit ledger jobs (worker, low frequency; registered through billing/jobs.ts). Database work only, idempotent:
 *   - usage:   one USAGE row per organization, meter and closed UTC day, from usage_records (re-computed for the last
 *              two closed days, so late records are picked up);
 *   - grants:  one GRANT row per organization, meter and usage window: the plan allowance (with overrides, without
 *              add-ons, which have their own PURCHASE / GRANT rows);
 *   - expiry:  when a window has closed, its unused positive balance is written off with one EXPIRY row.
 */
import { db, Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { getEntitlements, monthlyWindow } from "./service";
import { LEDGER_METERS, periodKeyOf, writeLedgerEntry } from "./ledger";
import { METER_LIMIT, isMeterKey, type MeterKey } from "./catalog";

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function anchors(orgIds: string[]) {
  if (!orgIds.length) return new Map<string, Date | null>();
  const subs = await db().subscription.findMany({
    where: { organizationId: { in: orgIds }, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true, currentPeriodStart: true },
  });
  const out = new Map<string, Date | null>();
  for (const s of subs) if (!out.has(s.organizationId)) out.set(s.organizationId, s.currentPeriodStart);
  return out;
}

/** Aggregate the last `closedDays` closed UTC days of usage_records into USAGE ledger rows. Returns rows written/updated. */
export async function aggregateUsageIntoLedger(now = new Date(), closedDays = 2): Promise<number> {
  let n = 0;
  for (let i = closedDays; i >= 1; i--) {
    const day = new Date(utcDay(now).getTime() - i * DAY);
    const next = new Date(day.getTime() + DAY);
    const rows = await db().usageRecord.groupBy({ by: ["organizationId", "meter"], where: { occurredAt: { gte: day, lt: next }, meter: { in: [...LEDGER_METERS] } }, _sum: { quantity: true } });
    const anchor = await anchors([...new Set(rows.map((r) => r.organizationId))]);
    const dayKey = day.toISOString().slice(0, 10);
    for (const r of rows) {
      if (!isMeterKey(r.meter)) continue;
      const qty = r._sum.quantity ?? 0n;
      if (qty <= 0n) continue;
      const w = monthlyWindow(anchor.get(r.organizationId) ?? null, new Date(day.getTime() + DAY / 2));
      const sourceId = `${r.organizationId}:${r.meter}:${dayKey}`;
      await db().creditLedgerEntry.upsert({
        where: { sourceType_sourceId_kind: { sourceType: "usage_day", sourceId, kind: "USAGE" } },
        update: { delta: -qty },
        create: { organizationId: r.organizationId, meter: r.meter, kind: "USAGE", delta: -qty, periodKey: periodKeyOf(w.start), periodStart: w.start, periodEnd: w.end, sourceType: "usage_day", sourceId },
      });
      n++;
    }
  }
  return n;
}

const GRANT_BATCH = 500;

/** Write the plan allowance of the current window for organizations with a live subscription or a running trial. */
export async function grantPlanPeriods(now = new Date()): Promise<number> {
  const [subs, trials] = await Promise.all([
    db().subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { organizationId: true, currentPeriodStart: true }, orderBy: { createdAt: "desc" }, take: 5_000 }),
    db().entitlementTrial.findMany({ where: { startedAt: { lte: now }, endsAt: { gt: now } }, select: { organizationId: true }, take: 5_000 }),
  ]);
  const anchor = new Map<string, Date | null>();
  for (const s of subs) if (!anchor.has(s.organizationId)) anchor.set(s.organizationId, s.currentPeriodStart);
  for (const t of trials) if (!anchor.has(t.organizationId)) anchor.set(t.organizationId, null);
  // Organizations whose current window has no grant yet (the ai.credits row marks a processed window).
  const pending: { org: string; window: { start: Date; end: Date } }[] = [];
  const candidates = [...anchor].map(([org, a]) => ({ org, window: monthlyWindow(a, now) }));
  for (let i = 0; i < candidates.length; i += 1_000) {
    const chunk = candidates.slice(i, i + 1_000);
    const have = await db().creditLedgerEntry.findMany({ where: { sourceType: "plan_period", kind: "GRANT", sourceId: { in: chunk.map((c) => `${c.org}:ai.credits:${periodKeyOf(c.window.start)}`) } }, select: { sourceId: true } });
    const done = new Set(have.map((h) => h.sourceId));
    for (const c of chunk) if (!done.has(`${c.org}:ai.credits:${periodKeyOf(c.window.start)}`)) pending.push(c);
  }
  let n = 0;
  for (const p of pending.slice(0, GRANT_BATCH)) {
    try {
      const ent = await getEntitlements(p.org);
      for (const meter of LEDGER_METERS) {
        const limit = ent.limits[METER_LIMIT[meter]];
        // Unlimited allowances are not ledgered (no finite grant); the ai.credits marker row is always written.
        if (limit === null || (limit <= 0 && meter !== "ai.credits")) continue;
        if (await writeLedgerEntry(db(), { organizationId: p.org, meter, kind: "GRANT", delta: BigInt(limit), period: p.window, sourceType: "plan_period", sourceId: `${p.org}:${meter}:${periodKeyOf(p.window.start)}`, reason: `plan:${ent.plan}` })) n++;
      }
    } catch (err) {
      logger.warn({ organizationId: p.org, err: err instanceof Error ? err.message : String(err) }, "credit ledger: plan grant skipped");
    }
  }
  return n;
}

/** Write off the unused balance of closed windows that had a plan grant. Bounded per run. */
export async function expireClosedPeriods(now = new Date()): Promise<number> {
  const closed = await db().$queryRaw<{ organization_id: string; meter: string; period_key: string; period_start: Date; period_end: Date; balance: bigint }[]>(Prisma.sql`
    SELECT g.organization_id, g.meter, g.period_key, g.period_start, g.period_end,
           (SELECT COALESCE(SUM(e.delta), 0) FROM credit_ledger_entries e
             WHERE e.organization_id = g.organization_id AND e.meter = g.meter AND e.period_key = g.period_key)::bigint AS balance
    FROM credit_ledger_entries g
    WHERE g.kind = 'GRANT' AND g.source_type = 'plan_period' AND g.period_end <= ${now}
      AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries x WHERE x.kind = 'EXPIRY' AND x.source_type = 'period_close'
                      AND x.source_id = g.organization_id::text || ':' || g.meter || ':' || g.period_key)
    ORDER BY g.period_end ASC
    LIMIT 500`);
  let n = 0;
  for (const c of closed) {
    if (!isMeterKey(c.meter)) continue;
    const remaining = c.balance > 0n ? c.balance : 0n;
    // Zero-delta rows still mark the window as closed, so it is not scanned again.
    if (await writeLedgerEntry(db(), { organizationId: c.organization_id, meter: c.meter as MeterKey, kind: "EXPIRY", delta: -remaining, period: { start: c.period_start, end: c.period_end }, sourceType: "period_close", sourceId: `${c.organization_id}:${c.meter}:${c.period_key}`, reason: "unused allowance expired at window end" })) n++;
  }
  return n;
}
