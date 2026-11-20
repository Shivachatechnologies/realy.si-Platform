import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, PRIORITIES } from "./common";

const DAY = 86_400_000;
const HOUR = 3_600_000;

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Support analytics for a period, computed from tickets only (nothing estimated): daily volume opened vs solved,
 * first-response and resolution time (median / 90th percentile, by priority), SLA attainment and customer
 * satisfaction (CSAT = share of 4–5 ratings) with the response rate. Values are null when there is no data.
 */
export async function supportAnalytics(ctx: RequestContext, organizationId: string, companyId: string, days: number, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY);
  const from = new Date(end.getTime() - days * DAY);
  const scope = { organizationId, companyId };
  const [opened, solved, responded, rated, solvedCount] = await Promise.all([
    db().supportTicket.findMany({ where: { ...scope, createdAt: { gte: from, lt: end } }, select: { createdAt: true }, take: 20_000 }),
    db().supportTicket.findMany({ where: { ...scope, solvedAt: { gte: from, lt: end } }, select: { createdAt: true, solvedAt: true, priority: true, resolutionDueAt: true, resolutionBreachedAt: true }, take: 20_000 }),
    db().supportTicket.findMany({ where: { ...scope, firstRespondedAt: { gte: from, lt: end } }, select: { createdAt: true, firstRespondedAt: true, priority: true, firstResponseBreachedAt: true, firstResponseDueAt: true }, take: 20_000 }),
    db().supportTicket.findMany({ where: { ...scope, csatRatedAt: { gte: from, lt: end } }, select: { csatScore: true }, take: 20_000 }),
    db().supportTicket.count({ where: { ...scope, solvedAt: { gte: from, lt: end } } }),
  ]);

  const series = Array.from({ length: days }, (_, i) => ({ date: new Date(from.getTime() + i * DAY).toISOString().slice(0, 10), opened: 0, solved: 0 }));
  const idx = (d: Date) => Math.floor((d.getTime() - from.getTime()) / DAY);
  for (const r of opened) {
    const s = series[idx(r.createdAt)];
    if (s) s.opened++;
  }
  for (const r of solved) {
    const s = series[idx(r.solvedAt!)];
    if (s) s.solved++;
  }

  const frt = responded.map((r) => (r.firstRespondedAt!.getTime() - r.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
  const res = solved.map((r) => (r.solvedAt!.getTime() - r.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
  const byPriority = PRIORITIES.map((priority) => {
    const f = responded.filter((r) => r.priority === priority).map((r) => (r.firstRespondedAt!.getTime() - r.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
    const s = solved.filter((r) => r.priority === priority).map((r) => (r.solvedAt!.getTime() - r.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
    return { priority, firstResponse: round1(quantile(f, 0.5)), resolution: round1(quantile(s, 0.5)), responded: f.length, solved: s.length };
  });

  const withFrTarget = responded.filter((r) => r.firstResponseDueAt);
  const withResTarget = solved.filter((r) => r.resolutionDueAt);
  const scores = rated.map((r) => r.csatScore).filter((s): s is number => typeof s === "number");
  const distribution = [1, 2, 3, 4, 5].map((score) => ({ score, count: scores.filter((s) => s === score).length }));

  return {
    days,
    from,
    series,
    totals: { opened: opened.length, solved: solved.length },
    firstResponse: { median: round1(quantile(frt, 0.5)), p90: round1(quantile(frt, 0.9)), count: frt.length },
    resolution: { median: round1(quantile(res, 0.5)), p90: round1(quantile(res, 0.9)), count: res.length },
    byPriority,
    sla: {
      firstResponse: withFrTarget.length ? Math.round((withFrTarget.filter((r) => !r.firstResponseBreachedAt).length / withFrTarget.length) * 1000) / 10 : null,
      resolution: withResTarget.length ? Math.round((withResTarget.filter((r) => !r.resolutionBreachedAt).length / withResTarget.length) * 1000) / 10 : null,
    },
    csat: {
      ratings: scores.length,
      score: scores.length ? Math.round((scores.filter((s) => s >= 4).length / scores.length) * 1000) / 10 : null,
      average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      responseRate: solvedCount ? Math.round((Math.min(scores.length, solvedCount) / solvedCount) * 1000) / 10 : null,
      distribution,
    },
  };
}
