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

const QUALIFYING = ["INTERESTED", "MEETING_REQUESTED", "MEETING_BOOKED", "CALLBACK_REQUESTED", "PAYMENT_PROMISED"] as const;

/**
 * Call → meeting funnel over the last `days`, from stored rows only: outbound calls placed (the provider accepted
 * them), connected (answered by a person), conversations (≥ 30 s), qualified, meetings booked from calls, total cost
 * (AI provider + Twilio leg) and cost per meeting; plus customer-meeting outcomes and meeting-intelligence coverage.
 */
export async function callMeetingFunnel(ctx: RequestContext, organizationId: string, companyId: string, days = 30) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const since = new Date(Date.now() - days * 86_400_000);
  const scope = { organizationId, companyId };
  const [calls, crmMeetings, intel] = await Promise.all([
    db().voiceCall.findMany({
      where: { ...scope, direction: "OUTBOUND", externalCallId: { not: null }, createdAt: { gte: since } },
      select: { status: true, outcome: true, durationSec: true, analysis: true, results: true, costMinor: true, telephonyCostMinor: true, costCurrency: true, campaignId: true },
      take: 20_000,
    }),
    db().crmMeeting.groupBy({ by: ["status"], where: { ...scope, startsAt: { gte: since, lte: new Date() } }, _count: { _all: true } }),
    db().meetingIntel.findMany({ where: { ...scope, kind: "CRM", updatedAt: { gte: since } }, select: { prepBuiltAt: true, transcriptAt: true, summary: true, appliedAt: true, followUpStatus: true } }),
  ]);
  const connected = calls.filter((c) => c.status === "ENDED" && (c.durationSec ?? 0) > 0 && c.outcome !== "NO_ANSWER" && c.outcome !== "VOICEMAIL");
  const conversations = connected.filter((c) => (c.durationSec ?? 0) >= 30);
  const isMeeting = (c: (typeof calls)[number]) => c.outcome === "MEETING_BOOKED" || (Array.isArray(c.results) && (c.results as { type?: string }[]).some((r) => r.type === "crm_meeting"));
  const qualified = connected.filter((c) => (QUALIFYING as readonly string[]).includes(c.outcome ?? "") || isMeeting(c) || (c.analysis as Record<string, unknown> | null)?.qualified === true);
  const meetings = calls.filter(isMeeting).length;
  const cost = calls.reduce((s, c) => s + (c.costMinor ?? BigInt(0)) + (c.telephonyCostMinor ?? BigInt(0)), BigInt(0));
  const m = (s: string) => crmMeetings.find((x) => x.status === s)?._count._all ?? 0;
  return {
    days,
    placed: calls.length,
    connected: connected.length,
    connectRate: calls.length ? Math.round((connected.length / calls.length) * 100) : null,
    conversations: conversations.length,
    qualified: qualified.length,
    meetings,
    costMinor: cost,
    currency: calls.find((c) => c.costMinor !== null)?.costCurrency ?? "USD",
    costPerMeetingMinor: meetings ? cost / BigInt(meetings) : null,
    campaignCalls: calls.filter((c) => c.campaignId).length,
    customerMeetings: { held: m("COMPLETED"), cancelled: m("CANCELLED"), unconfirmed: m("SCHEDULED") },
    intel: {
      prepared: intel.filter((i) => i.prepBuiltAt).length,
      transcripts: intel.filter((i) => i.transcriptAt).length,
      summarized: intel.filter((i) => i.summary).length,
      applied: intel.filter((i) => i.appliedAt).length,
      followUpsSent: intel.filter((i) => i.followUpStatus === "SENT").length,
    },
  };
}
