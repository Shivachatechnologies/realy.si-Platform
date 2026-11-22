import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { providerInfo } from "@/server/modules/integrations/catalog";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { providerCredentialState } from "./integrations";

/**
 * Telephony admin (Admin → Telephony, stream F): a cross-tenant view of voice providers (Vapi, Retell, Twilio), phone
 * numbers, AI voice agents, call sessions, queues (scheduled and queued calls), transfers, costs and provider webhooks.
 *
 * Call metadata (numbers, status, duration, cost) is shown to telephony readers. Transcripts and recordings are
 * personal data: they are released only through `voiceCallRecording`, which needs platform.security.manage
 * (MFA-gated) plus a reason, and writes a SECURITY audit record for every access.
 */

/** Same permissions as the `telephony` console section. */
const READ = ["platform.organizations.read", "platform.security.read", "platform.controls.manage"];
const RECORDINGS = "platform.security.manage";
const VOICE_PROVIDERS = ["vapi", "retell", "twilio_voice", "sip_trunk"] as const;

const ACTIVE: Prisma.VoiceCallWhereInput["status"] = { in: ["QUEUED", "RINGING", "IN_PROGRESS"] };

const orgNames = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db().organization.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return (id: string) => rows.find((o) => o.id === id)?.name ?? id.slice(0, 8);
};

/** Overview: providers, numbers, agents, live/queued calls, 30-day volume, minutes, failure rate, spend, transfers. */
export async function telephonyOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const d30 = daysAgo(30);
  const [numbers, agents, byStatus30, live, queued, minutes, transfers, costByCurrency, ledger, twilioConns, providerConns, topOrgs] = await Promise.all([
    db().voicePhoneNumber.groupBy({ by: ["provider", "source"], where: { releasedAt: null }, _count: { _all: true } }),
    db().voiceAgent.groupBy({ by: ["provider", "syncStatus"], where: { archivedAt: null }, _count: { _all: true } }),
    db().voiceCall.groupBy({ by: ["status"], where: { createdAt: { gte: d30 } }, _count: { _all: true } }),
    db().voiceCall.count({ where: { status: ACTIVE } }),
    db().voiceCall.count({ where: { status: { in: ["SCHEDULED", "AWAITING_APPROVAL"] } } }),
    db().voiceCall.aggregate({ where: { createdAt: { gte: d30 }, durationSec: { not: null } }, _sum: { durationSec: true } }),
    db().voiceCall.count({ where: { createdAt: { gte: d30 }, transferredTo: { not: null } } }),
    db().$queryRaw<{ currency: string; provider: bigint | null; telephony: bigint | null }[]>`
      SELECT cost_currency AS currency, sum(cost_minor)::bigint AS provider, sum(telephony_cost_minor)::bigint AS telephony
      FROM voice_calls WHERE created_at >= ${d30} GROUP BY 1`,
    db().costLedgerEntry.groupBy({ by: ["category", "provider"], where: { occurredAt: { gte: d30 }, category: { in: ["TELEPHONY", "VOICE", "SMS"] } }, _sum: { costMicros: true, units: true } }),
    db().integrationConnection.groupBy({ by: ["status"], where: { provider: "twilio_voice" }, _count: { _all: true } }),
    db().integrationConnection.groupBy({ by: ["provider", "status"], where: { provider: { in: ["vapi", "retell", "twilio", "twilio_voice"] } }, _count: { _all: true } }),
    db().voiceCall.groupBy({ by: ["organizationId"], where: { createdAt: { gte: d30 } }, _count: { _all: true }, _sum: { durationSec: true }, orderBy: { _count: { organizationId: "desc" } }, take: 10 }),
  ]);
  const name = await orgNames(topOrgs.map((o) => o.organizationId));
  const status = (s: string) => byStatus30.find((b) => b.status === s)?._count._all ?? 0;
  const ended = status("ENDED");
  const failed = status("FAILED");
  return {
    providers: {
      // Platform-managed keys (Admin → Platform keys): presence only, never values.
      platformKeys: VOICE_PROVIDERS.map((p) => {
        const info = providerInfo(p);
        return { provider: p, name: info?.name ?? p, state: info ? providerCredentialState(info).platformKeys : ("missing" as const) };
      }),
      twilioConnections: Object.fromEntries(twilioConns.map((c) => [c.status, c._count._all])) as Record<string, number>,
      connections: providerConns.map((c) => ({ provider: c.provider, status: c.status, count: c._count._all })),
    },
    numbers: numbers.map((n) => ({ provider: n.provider, source: n.source, count: n._count._all })),
    agents: agents.map((a) => ({ provider: a.provider, syncStatus: a.syncStatus, count: a._count._all })),
    calls30d: { byStatus: byStatus30.map((b) => ({ status: b.status, count: b._count._all })), total: byStatus30.reduce((n, b) => n + b._count._all, 0), failureRate: ended + failed ? failed / (ended + failed) : null, minutes: Math.round((minutes._sum.durationSec ?? 0) / 60), transfers },
    live,
    queued,
    callCosts: costByCurrency.map((c) => ({ currency: c.currency, providerMinor: Number(c.provider ?? 0), telephonyMinor: Number(c.telephony ?? 0) })),
    ledger: ledger.map((l) => ({ category: l.category, provider: l.provider, costMicros: Number(l._sum.costMicros ?? 0n), units: l._sum.units ?? 0 })),
    topOrganizations: topOrgs.map((o) => ({ organizationId: o.organizationId, organizationName: name(o.organizationId), calls: o._count._all, minutes: Math.round((o._sum.durationSec ?? 0) / 60) })),
  };
}

const callFilters = z.object({
  status: z.enum(["AWAITING_APPROVAL", "SCHEDULED", "QUEUED", "RINGING", "IN_PROGRESS", "ENDED", "FAILED", "BLOCKED", "CANCELLED", "REJECTED", "live"]).optional().catch(undefined),
  direction: z.enum(["OUTBOUND", "INBOUND"]).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  transferred: z.enum(["1"]).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** Call sessions across tenants (metadata only; numbers are masked except the last 4 digits). */
export async function listVoiceCalls(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof callFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = callFilters.parse(raw);
  const rows = await db().voiceCall.findMany({
    where: { ...(f.status === "live" ? { status: ACTIVE } : f.status ? { status: f.status } : {}), ...(f.direction ? { direction: f.direction } : {}), ...(f.org ? { organizationId: f.org } : {}), ...(f.transferred ? { transferredTo: { not: null } } : {}) },
    orderBy: { id: "desc" },
    take: 51,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    select: { id: true, organizationId: true, direction: true, status: true, provider: true, telephony: true, toNumber: true, fromNumber: true, durationSec: true, endedReason: true, error: true, blockedReason: true, transferredTo: true, costMinor: true, telephonyCostMinor: true, costCurrency: true, outcome: true, startedAt: true, createdAt: true, recordingUrl: true },
  });
  const more = rows.length > 50;
  const data = more ? rows.slice(0, 50) : rows;
  const name = await orgNames(data.map((c) => c.organizationId));
  return {
    filters: f,
    data: data.map(({ recordingUrl, ...c }) => ({ ...c, toNumber: maskNumber(c.toNumber), fromNumber: c.fromNumber ? maskNumber(c.fromNumber) : null, transferredTo: c.transferredTo ? maskNumber(c.transferredTo) : null, hasRecording: !!recordingUrl, organizationName: name(c.organizationId), costMinor: c.costMinor === null ? null : Number(c.costMinor), telephonyCostMinor: c.telephonyCostMinor === null ? null : Number(c.telephonyCostMinor) })),
    nextCursor: more ? data[data.length - 1]!.id : null,
  };
}

/** "+38640123456" → "•••••••3456". */
export const maskNumber = (n: string) => (n.length <= 4 ? "••••" : `${"•".repeat(Math.min(n.length - 4, 8))}${n.slice(-4)}`);

/** Phone numbers across tenants (keyset pages). */
export async function listVoiceNumbers(ctx: RequestContext, raw: { cursor?: string; org?: string } = {}) {
  await requireAnyPlatform(ctx, READ);
  const cursor = raw.cursor && isUuid(raw.cursor) ? raw.cursor : undefined;
  const rows = await db().voicePhoneNumber.findMany({
    where: { ...(raw.org && isUuid(raw.org) ? { organizationId: raw.org } : {}) },
    orderBy: { id: "desc" },
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, organizationId: true, provider: true, source: true, number: true, label: true, releasedAt: true, createdAt: true, inboundAgent: { select: { name: true } } },
  });
  const more = rows.length > 50;
  const data = more ? rows.slice(0, 50) : rows;
  const name = await orgNames(data.map((n) => n.organizationId));
  return { data: data.map((n) => ({ ...n, number: maskNumber(n.number), organizationName: name(n.organizationId) })), nextCursor: more ? data[data.length - 1]!.id : null };
}

/** AI voice agents across tenants (sync state, provider; instructions and knowledge are not exposed). */
export async function listVoiceAgents(ctx: RequestContext, raw: { cursor?: string } = {}) {
  await requireAnyPlatform(ctx, READ);
  const cursor = raw.cursor && isUuid(raw.cursor) ? raw.cursor : undefined;
  const rows = await db().voiceAgent.findMany({ where: { archivedAt: null }, orderBy: { id: "desc" }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, organizationId: true, name: true, goal: true, provider: true, language: true, syncStatus: true, syncError: true, syncedAt: true, createdAt: true } });
  const more = rows.length > 50;
  const data = more ? rows.slice(0, 50) : rows;
  const counts = data.length ? await db().voiceCall.groupBy({ by: ["agentId"], where: { agentId: { in: data.map((a) => a.id) }, createdAt: { gte: daysAgo(30) } }, _count: { _all: true } }) : [];
  const name = await orgNames(data.map((a) => a.organizationId));
  return { data: data.map((a) => ({ ...a, organizationName: name(a.organizationId), calls30d: counts.find((c) => c.agentId === a.id)?._count._all ?? 0 })), nextCursor: more ? data[data.length - 1]!.id : null };
}

export const recordingInput = z.object({ reason: reasonSchema });

/** Transcript and recording of one call: permission + reason, audited (SECURITY) on every access. */
export async function voiceCallRecording(ctx: RequestContext, callId: string, raw: z.input<typeof recordingInput>) {
  const { reason } = recordingInput.parse(raw);
  if (!isUuid(callId)) throw notFound("Call");
  return transaction(async (tx) => {
    await requirePermission(ctx, RECORDINGS, platformChain(), tx);
    const call = await tx.voiceCall.findUnique({ where: { id: callId }, select: { id: true, organizationId: true, companyId: true, recordingUrl: true, transcript: true, summary: true } });
    if (!call) throw notFound("Call");
    const lines = await tx.voiceTranscriptLine.findMany({ where: { callId: call.id, companyId: call.companyId }, orderBy: [{ atSec: "asc" }, { createdAt: "asc" }], take: 2000, select: { role: true, text: true, atSec: true } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: call.organizationId, action: "platform.voice_recording_accessed", resourceType: "voice_call", resourceId: call.id, newValue: { transcriptLines: lines.length, recording: !!call.recordingUrl }, reason });
    const legacy = Array.isArray(call.transcript) ? (call.transcript as { role?: string; text?: string; message?: string }[]).slice(0, 2000).map((l) => ({ role: String(l.role ?? "unknown"), text: String(l.text ?? l.message ?? ""), atSec: null as number | null })) : [];
    return { callId: call.id, recordingUrl: call.recordingUrl, summary: call.summary, transcript: lines.length ? lines : legacy };
  });
}
