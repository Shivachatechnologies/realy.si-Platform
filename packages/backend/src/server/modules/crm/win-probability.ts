import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";

/**
 * Computed win probability of an open deal, from the company's own history — no hidden model, every point is itemised:
 *
 *   base        how often deals that reached this stage were won (closed deals of the pipeline), smoothed toward the
 *               stage's configured probability while there is little history (k = 5 pseudo-deals)
 *   stage_age   days in the current stage vs the pipeline's "stale after" days (−8 past it, −15 past twice)
 *   activity    days since the last logged activity, sent email or meeting (+5 within 7 days, −8 after 30, −5 none)
 *   overdue     the expected close date has passed (−10)
 *   amount      more than twice the median won deal of the same currency (−5)
 *   owner       the owner's win rate vs the company's (±10 at most; needs 5 closed deals of the owner)
 *
 * The result (1–99) is stored on the deal (predictedProbability, predictedFactors) by the crm.deal_win_probability job
 * and shown next to the stage probability; it never overwrites a probability a person set.
 */

const DAY = 86_400_000;
const SMOOTHING = 5;
const HISTORY_DAYS = 730;

export type WinFactorKey = "base" | "stage_age" | "activity" | "overdue" | "amount" | "owner";
export interface WinFactor {
  key: WinFactorKey;
  delta: number;
  /** Plain numbers behind the factor (e.g. won / closed, days). */
  detail: Record<string, number | null>;
}
export interface WinPrediction {
  probability: number;
  factors: WinFactor[];
}

export interface DealFacts {
  stageProbability: number;
  /** Closed deals of the pipeline that reached this stage (won / total). */
  stageWon: number;
  stageClosed: number;
  daysInStage: number;
  staleDays: number;
  daysSinceActivity: number | null;
  closeDatePassed: boolean;
  amountMinor: bigint;
  medianWonMinor: bigint | null;
  owner: { won: number; closed: number } | null;
  company: { won: number; closed: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pure scoring from the facts (unit-tested). */
export function predictWin(f: DealFacts): WinPrediction {
  const base = Math.round((100 * (f.stageWon + (SMOOTHING * f.stageProbability) / 100)) / (f.stageClosed + SMOOTHING));
  const factors: WinFactor[] = [{ key: "base", delta: base, detail: { won: f.stageWon, closed: f.stageClosed, stageProbability: f.stageProbability } }];
  const age = f.daysInStage > 2 * f.staleDays ? -15 : f.daysInStage > f.staleDays ? -8 : 0;
  factors.push({ key: "stage_age", delta: age, detail: { days: f.daysInStage, staleDays: f.staleDays } });
  const act = f.daysSinceActivity === null ? -5 : f.daysSinceActivity <= 7 ? 5 : f.daysSinceActivity > 30 ? -8 : 0;
  factors.push({ key: "activity", delta: act, detail: { days: f.daysSinceActivity } });
  factors.push({ key: "overdue", delta: f.closeDatePassed ? -10 : 0, detail: {} });
  const big = f.medianWonMinor !== null && f.medianWonMinor > 0n && f.amountMinor > 2n * f.medianWonMinor;
  factors.push({ key: "amount", delta: big ? -5 : 0, detail: { medianWon: f.medianWonMinor === null ? null : Number(f.medianWonMinor) } });
  let owner = 0;
  if (f.owner && f.owner.closed >= 5 && f.company.closed > 0) owner = clamp(Math.round((f.owner.won / f.owner.closed - f.company.won / f.company.closed) * 30), -10, 10);
  factors.push({ key: "owner", delta: owner, detail: { won: f.owner?.won ?? null, closed: f.owner?.closed ?? null } });
  const probability = clamp(factors.reduce((s, x) => s + x.delta, 0), 1, 99);
  return { probability, factors };
}

const median = (xs: bigint[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)]!;
};

/** Recompute the open deals of one company (bounded); returns how many were updated. */
export async function refreshCompanyWinProbabilities(organizationId: string, companyId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY);
  const [open, closed] = await Promise.all([
    db().crmDeal.findMany({
      where: { organizationId, companyId, status: "OPEN", archivedAt: null },
      select: { id: true, pipelineId: true, stageId: true, ownerId: true, amountMinor: true, currency: true, expectedCloseDate: true, stageEnteredAt: true, stage: { select: { probability: true } }, pipeline: { select: { staleDays: true } } },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    }),
    db().crmDeal.findMany({
      where: { organizationId, companyId, status: { in: ["WON", "LOST"] }, archivedAt: null, closedAt: { gte: since } },
      select: { id: true, pipelineId: true, stageId: true, status: true, ownerId: true, amountMinor: true, currency: true },
      take: 5000,
    }),
  ]);
  if (!open.length) return 0;
  // Stages each closed deal passed through (its stage history plus the stage it closed in).
  const changes = closed.length
    ? await db().crmDealStageChange.findMany({ where: { companyId, dealId: { in: closed.map((d) => d.id) } }, select: { dealId: true, toStageId: true, fromStageId: true }, take: 50_000 })
    : [];
  const reached = new Map<string, Set<string>>();
  for (const d of closed) reached.set(d.id, new Set([d.stageId]));
  for (const c of changes) {
    const s = reached.get(c.dealId);
    if (!s) continue;
    s.add(c.toStageId);
    if (c.fromStageId) s.add(c.fromStageId);
  }
  const stageStats = new Map<string, { won: number; closed: number }>();
  const ownerStats = new Map<string, { won: number; closed: number }>();
  const wonAmounts = new Map<string, bigint[]>();
  const companyStats = { won: 0, closed: 0 };
  for (const d of closed) {
    const won = d.status === "WON" ? 1 : 0;
    companyStats.won += won;
    companyStats.closed++;
    for (const stageId of reached.get(d.id) ?? []) {
      const s = stageStats.get(stageId) ?? { won: 0, closed: 0 };
      s.won += won;
      s.closed++;
      stageStats.set(stageId, s);
    }
    if (d.ownerId) {
      const o = ownerStats.get(d.ownerId) ?? { won: 0, closed: 0 };
      o.won += won;
      o.closed++;
      ownerStats.set(d.ownerId, o);
    }
    if (won) wonAmounts.set(d.currency, [...(wonAmounts.get(d.currency) ?? []), d.amountMinor]);
  }
  // Last touch per deal: logged activities, sent emails and meetings.
  const ids = open.map((d) => d.id);
  const [acts, mails, meets] = await Promise.all([
    db().crmActivity.groupBy({ by: ["dealId"], where: { companyId, dealId: { in: ids } }, _max: { occurredAt: true } }),
    db().crmOutreachMessage.groupBy({ by: ["dealId"], where: { companyId, dealId: { in: ids }, status: "SENT" }, _max: { sentAt: true } }),
    db().crmMeeting.groupBy({ by: ["dealId"], where: { companyId, dealId: { in: ids }, status: { not: "CANCELLED" }, startsAt: { lte: now } }, _max: { startsAt: true } }),
  ]);
  const last = new Map<string, number>();
  const touch = (id: string | null, d: Date | null | undefined) => {
    if (!id || !d) return;
    last.set(id, Math.max(last.get(id) ?? 0, d.getTime()));
  };
  for (const a of acts) touch(a.dealId, a._max.occurredAt);
  for (const m of mails) touch(m.dealId, m._max.sentAt);
  for (const m of meets) touch(m.dealId, m._max.startsAt);
  const medians = new Map([...wonAmounts].map(([c, xs]) => [c, median(xs)]));
  let n = 0;
  for (const d of open) {
    const s = stageStats.get(d.stageId) ?? { won: 0, closed: 0 };
    const lastAt = last.get(d.id);
    const p = predictWin({
      stageProbability: d.stage.probability,
      stageWon: s.won,
      stageClosed: s.closed,
      daysInStage: Math.floor((now.getTime() - d.stageEnteredAt.getTime()) / DAY),
      staleDays: d.pipeline.staleDays,
      daysSinceActivity: lastAt ? Math.floor((now.getTime() - lastAt) / DAY) : null,
      closeDatePassed: !!d.expectedCloseDate && d.expectedCloseDate.getTime() + DAY < now.getTime(),
      amountMinor: d.amountMinor,
      medianWonMinor: medians.get(d.currency) ?? null,
      owner: d.ownerId ? (ownerStats.get(d.ownerId) ?? { won: 0, closed: 0 }) : null,
      company: companyStats,
    });
    await db().crmDeal.update({ where: { id: d.id }, data: { predictedProbability: p.probability, predictedAt: now, predictedFactors: p as unknown as Prisma.InputJsonValue } });
    n++;
  }
  return n;
}

/** Worker job: refresh every company with open deals (bounded per run; oldest predictions first). */
export async function refreshWinProbabilities(now = new Date()): Promise<number> {
  const groups = await db().crmDeal.groupBy({ by: ["organizationId", "companyId"], where: { status: "OPEN", archivedAt: null }, _min: { predictedAt: true } });
  // Never-computed companies first, then the stalest; at most 200 companies per run.
  const companies = groups.sort((a, b) => (a._min.predictedAt?.getTime() ?? 0) - (b._min.predictedAt?.getTime() ?? 0)).slice(0, 200);
  let n = 0;
  for (const c of companies) {
    try {
      n += await refreshCompanyWinProbabilities(c.organizationId, c.companyId, now);
    } catch (err) {
      logger.warn({ companyId: c.companyId, err: err instanceof Error ? err.message : String(err) }, "deal win probability refresh failed");
    }
  }
  return n;
}

/** Stored prediction as shown in the UI and AI tools (null when not computed yet). */
export function storedPrediction(d: { predictedProbability: number | null; predictedAt: Date | null; predictedFactors: unknown }): (WinPrediction & { at: Date }) | null {
  if (d.predictedProbability === null || !d.predictedAt) return null;
  const f = d.predictedFactors as { factors?: WinFactor[] } | null;
  return { probability: d.predictedProbability, factors: Array.isArray(f?.factors) ? f.factors : [], at: d.predictedAt };
}
