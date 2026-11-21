import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, OUTCOMES, SENTIMENTS } from "./common";

/** Outcome analytics of the phone team over the last `days` (from stored calls only). */
export async function voiceAnalytics(ctx: RequestContext, organizationId: string, companyId: string, days = 30) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { organizationId, companyId, createdAt: { gte: since } };
  const [byOutcome, bySentiment, byStatus, ended, rows] = await Promise.all([
    db().voiceCall.groupBy({ by: ["outcome"], where: { ...where, outcome: { not: null } }, _count: { _all: true } }),
    db().voiceCall.groupBy({ by: ["sentiment"], where: { ...where, sentiment: { not: null } }, _count: { _all: true } }),
    db().voiceCall.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db().voiceCall.aggregate({ where: { ...where, status: "ENDED" }, _sum: { durationSec: true, costMinor: true }, _count: { _all: true } }),
    db().voiceCall.findMany({ where, select: { createdAt: true, direction: true, status: true, durationSec: true }, take: 20_000 }),
  ]);
  const count = (list: { _count: { _all: number } }[]) => list.reduce((s, x) => s + x._count._all, 0);
  const connected = rows.filter((r) => r.status === "ENDED" && (r.durationSec ?? 0) > 0).length;
  const placed = rows.filter((r) => r.direction === "OUTBOUND" && ["QUEUED", "RINGING", "IN_PROGRESS", "ENDED", "FAILED"].includes(r.status)).length;
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const daily = new Map<string, { inbound: number; outbound: number }>();
  for (let i = days - 1; i >= 0; i--) daily.set(dayKey(new Date(Date.now() - i * 86_400_000)), { inbound: 0, outbound: 0 });
  for (const r of rows) {
    const d = daily.get(dayKey(r.createdAt));
    if (d && r.status !== "AWAITING_APPROVAL" && r.status !== "REJECTED" && r.status !== "CANCELLED") d[r.direction === "INBOUND" ? "inbound" : "outbound"]++;
  }
  return {
    days,
    total: rows.length,
    inbound: rows.filter((r) => r.direction === "INBOUND").length,
    outboundPlaced: placed,
    connected,
    connectRate: placed ? Math.round((rows.filter((r) => r.direction === "OUTBOUND" && r.status === "ENDED" && (r.durationSec ?? 0) > 0).length / placed) * 100) : null,
    avgDurationSec: connected ? Math.round((ended._sum.durationSec ?? 0) / Math.max(1, connected)) : null,
    costCents: ended._sum.costMinor ?? BigInt(0),
    outcomes: OUTCOMES.map((o) => ({ key: o, count: byOutcome.find((b) => b.outcome === o)?._count._all ?? 0 })).filter((o) => o.count > 0),
    sentiments: SENTIMENTS.map((s) => ({ key: s, count: bySentiment.find((b) => b.sentiment === s)?._count._all ?? 0 })),
    statuses: byStatus.map((s) => ({ key: s.status, count: s._count._all })),
    awaitingApproval: byStatus.find((s) => s.status === "AWAITING_APPROVAL")?._count._all ?? 0,
    daily: [...daily.entries()].map(([day, v]) => ({ day, ...v })),
    analyzed: count(byOutcome),
  };
}
