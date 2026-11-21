import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the AI phone team (see src/server/core/metrics.ts). Registered in bi/registry.ts. */
export const VOICE_METRICS: MetricDefinition[] = [
  {
    key: "voice.calls_connected",
    labelKey: "voice.metrics.callsConnected",
    department: "sales",
    unit: "count",
    permission: "communication.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/voice/calls?view=past",
    compute: ({ organizationId, companyId }, { from, to }) => db().voiceCall.count({ where: { organizationId, companyId, status: "ENDED", durationSec: { gt: 0 }, endedAt: { gte: from, lt: to } } }),
  },
  {
    key: "voice.inbound_calls",
    labelKey: "voice.metrics.inboundCalls",
    department: "support",
    unit: "count",
    permission: "communication.read",
    kind: "flow",
    href: "/voice/calls?view=inbound",
    compute: ({ organizationId, companyId }, { from, to }) => db().voiceCall.count({ where: { organizationId, companyId, direction: "INBOUND", createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "voice.meetings_booked",
    labelKey: "voice.metrics.meetingsBooked",
    department: "sales",
    unit: "count",
    permission: "communication.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/voice/calls?outcome=MEETING_BOOKED",
    compute: ({ organizationId, companyId }, { from, to }) => db().voiceCall.count({ where: { organizationId, companyId, outcome: "MEETING_BOOKED", endedAt: { gte: from, lt: to } } }),
  },
  {
    key: "voice.connect_rate",
    labelKey: "voice.metrics.connectRate",
    department: "sales",
    unit: "percent",
    permission: "communication.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/voice/analytics",
    async compute({ organizationId, companyId }, { from, to }) {
      const where = { organizationId, companyId, direction: "OUTBOUND" as const, externalCallId: { not: null }, createdAt: { gte: from, lt: to } };
      const [placed, connected] = await Promise.all([db().voiceCall.count({ where }), db().voiceCall.count({ where: { ...where, status: "ENDED", durationSec: { gt: 0 }, outcome: { notIn: ["NO_ANSWER", "VOICEMAIL"] } } })]);
      return placed ? Math.round((connected / placed) * 100) : 0;
    },
  },
  {
    key: "voice.positive_sentiment_rate",
    labelKey: "voice.metrics.positiveSentiment",
    department: "support",
    unit: "percent",
    permission: "communication.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/voice/analytics",
    async compute({ organizationId, companyId }, { from, to }) {
      const where = { organizationId, companyId, sentiment: { in: ["POSITIVE" as const, "NEUTRAL" as const, "NEGATIVE" as const] }, endedAt: { gte: from, lt: to } };
      const [rated, positive] = await Promise.all([db().voiceCall.count({ where }), db().voiceCall.count({ where: { ...where, sentiment: "POSITIVE" } })]);
      return rated ? Math.round((positive / rated) * 100) : 0;
    },
  },
];
