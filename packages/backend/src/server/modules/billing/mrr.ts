/**
 * Daily MRR snapshots (mrr_snapshots), written by a low-frequency worker job (billing.mrr-snapshot, every 6 h).
 *
 * MRR is computed from live subscription items (ACTIVE and PAST_DUE; annual / 12), per currency — never converted.
 * Movement compares each paying organization's MRR with the latest earlier snapshot:
 *   0 → x: new (reactivation when the organization had a subscription that ended before), x → y > x: expansion,
 *   x → y < x: contraction, x → 0: churn. The first snapshot ever is a baseline (movement unknown, stored as 0).
 * History exists only from the first run on; nothing is backfilled or estimated.
 */
import { db, Prisma } from "@/server/core/db";

const PAYING = ["ACTIVE", "PAST_DUE"] as const;

export const utcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface Movement {
  newMinor: bigint;
  expansionMinor: bigint;
  contractionMinor: bigint;
  churnMinor: bigint;
  reactivationMinor: bigint;
  newOrgs: number;
  churnedOrgs: number;
}

/** Pure movement between two { organizationId: mrrMinor } maps (unit-tested). */
export function mrrMovement(prev: Map<string, bigint>, cur: Map<string, bigint>, reactivated: Set<string>): Movement {
  const m: Movement = { newMinor: 0n, expansionMinor: 0n, contractionMinor: 0n, churnMinor: 0n, reactivationMinor: 0n, newOrgs: 0, churnedOrgs: 0 };
  for (const org of new Set([...prev.keys(), ...cur.keys()])) {
    const a = prev.get(org) ?? 0n;
    const b = cur.get(org) ?? 0n;
    if (a === 0n && b > 0n) {
      if (reactivated.has(org)) m.reactivationMinor += b;
      else {
        m.newMinor += b;
        m.newOrgs++;
      }
    } else if (a > 0n && b === 0n) {
      m.churnMinor += a;
      m.churnedOrgs++;
    } else if (b > a) m.expansionMinor += b - a;
    else if (b < a) m.contractionMinor += a - b;
  }
  return m;
}

const toMap = (j: unknown) => {
  const out = new Map<string, bigint>();
  if (j && typeof j === "object") for (const [k, v] of Object.entries(j as Record<string, unknown>)) if (typeof v === "string" && /^\d+$/.test(v)) out.set(k, BigInt(v));
  return out;
};
const toJson = (m: Map<string, bigint>) => Object.fromEntries([...m].map(([k, v]) => [k, v.toString()]));

/** Compute and upsert today's snapshot for every currency in use now or in the latest earlier snapshot. Returns rows written. */
export async function computeMrrSnapshot(now = new Date()): Promise<number> {
  const day = utcDay(now);
  const [items, counts, prevRows] = await Promise.all([
    db().subscriptionItem.findMany({
      where: { subscription: { status: { in: [...PAYING] } } },
      select: { quantity: true, unitAmountMinor: true, currency: true, subscription: { select: { interval: true, organizationId: true, plan: { select: { key: true } } } } },
    }),
    db().subscription.groupBy({ by: ["currency", "status"], where: { status: { in: ["ACTIVE", "PAST_DUE", "TRIALING"] } }, _count: { _all: true } }),
    // Latest snapshot before today, per currency.
    db().$queryRaw<{ currency: string; org_mrr: unknown }[]>(Prisma.sql`
      SELECT DISTINCT ON (currency) currency, org_mrr FROM mrr_snapshots WHERE day < ${day} ORDER BY currency, day DESC`),
  ]);
  const perCurrency = new Map<string, { org: Map<string, bigint>; plan: Map<string, bigint> }>();
  const bucket = (c: string) => {
    if (!perCurrency.has(c)) perCurrency.set(c, { org: new Map(), plan: new Map() });
    return perCurrency.get(c)!;
  };
  for (const i of items) {
    const amount = i.unitAmountMinor * BigInt(i.quantity);
    const monthly = i.subscription.interval === "YEAR" ? amount / 12n : amount;
    if (monthly <= 0n) continue;
    const b = bucket(i.currency);
    b.org.set(i.subscription.organizationId, (b.org.get(i.subscription.organizationId) ?? 0n) + monthly);
    b.plan.set(i.subscription.plan.key, (b.plan.get(i.subscription.plan.key) ?? 0n) + monthly);
  }
  const prev = new Map(prevRows.map((r) => [r.currency, toMap(r.org_mrr)]));
  for (const c of prev.keys()) bucket(c);

  // Organizations that start paying again after an earlier subscription ended count as reactivation.
  const starters = new Set<string>();
  for (const [c, b] of perCurrency) for (const org of b.org.keys()) if (!(prev.get(c)?.get(org) ?? 0n)) starters.add(org);
  const reactivated = new Set(
    starters.size
      ? (await db().subscription.findMany({ where: { organizationId: { in: [...starters] }, status: { in: ["CANCELED", "INCOMPLETE_EXPIRED", "UNPAID"] }, canceledAt: { lt: day } }, select: { organizationId: true }, distinct: ["organizationId"] })).map((s) => s.organizationId)
      : [],
  );

  let written = 0;
  for (const [currency, b] of perCurrency) {
    const before = prev.get(currency);
    const baseline = before === undefined;
    const mv = baseline ? mrrMovement(new Map(), new Map(), new Set()) : mrrMovement(before, b.org, reactivated);
    const n = (status: string) => counts.find((x) => x.currency === currency && x.status === status)?._count._all ?? 0;
    const data = {
      mrrMinor: [...b.org.values()].reduce((a, v) => a + v, 0n),
      ...mv,
      activeSubs: n("ACTIVE"),
      trialingSubs: n("TRIALING"),
      pastDueSubs: n("PAST_DUE"),
      payingOrgs: b.org.size,
      baseline,
      byPlan: toJson(b.plan),
      orgMrr: toJson(b.org),
    };
    await db().mrrSnapshot.upsert({ where: { day_currency: { day, currency } }, update: data, create: { day, currency, ...data } });
    written++;
  }
  return written;
}
