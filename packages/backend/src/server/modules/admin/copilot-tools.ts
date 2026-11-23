import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo } from "./access";

/**
 * Admin Copilot tool registry (stream C). Every tool is READ-ONLY: it wraps existing admin read paths or bounded,
 * aggregate queries, runs with the admin's own RequestContext (never an AGENT principal) and is offered only when the
 * admin holds one of its permissions. Each result carries records with console links, so answers can cite them.
 * There are no write tools: suggested next steps link to the console page whose existing, confirmed action applies.
 */

export interface CopilotRecord {
  label: string;
  href: string;
  detail?: string;
}
export interface CopilotToolResult {
  /** Short factual summary handed to the model (data, not instructions). */
  summary: string;
  records: CopilotRecord[];
  /** "Not configured" / "Not yet tracked" when the source does not exist. */
  unavailable?: string;
}
export interface CopilotTool {
  name: string;
  description: string;
  /** Any one of these platform permissions. */
  perms: string[];
  run: (ctx: RequestContext) => Promise<CopilotToolResult>;
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const money = (minor: bigint, currency: string) => `${(Number(minor) / 100).toFixed(2)} ${currency}`;

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: "platform_health",
    description: "Live database and Redis checks, configured providers (email, AI, Stripe), worker heartbeats and BullMQ queue depths.",
    perms: ["platform.ai.read", "platform.ai.manage", "platform.incidents.read", "platform.security.read"],
    async run() {
      const { platformHealth, queueCounts, workerHeartbeats } = await import("./monitoring");
      const [h, queues, beats] = await Promise.all([platformHealth(), queueCounts().catch(() => []), workerHeartbeats().catch(() => [])]);
      const busy = queues.filter((q) => (q.failed ?? 0) > 0 || (q.waiting ?? 0) > 50);
      return {
        summary: `database ${h.database ? "ok" : "DOWN"}, redis ${h.redis ? "ok" : "DOWN"}, email ${h.email ? "configured" : "not configured"}, AI ${h.ai ? "configured" : "not configured"}, Stripe ${h.stripe ? "configured" : "not configured"}; worker heartbeats: ${beats.length}; queues with failures or backlog: ${busy.map((q) => `${q.name} (waiting ${q.waiting ?? 0}, failed ${q.failed ?? 0})`).join(", ") || "none"}`,
        records: [{ label: "System status", href: "/system" }, ...busy.slice(0, 5).map((q) => ({ label: `Queue ${q.name}`, href: "/system/jobs", detail: `waiting ${q.waiting ?? 0}, failed ${q.failed ?? 0}` }))],
      };
    },
  },
  {
    name: "failed_jobs",
    description: "Background job runs that failed or were dead-lettered in the last 24 hours (worker_job_runs).",
    perms: ["platform.ai.read", "platform.ai.manage", "platform.controls.manage", "platform.incidents.read"],
    async run() {
      const rows = await db().workerJobRun.findMany({ where: { status: { in: ["FAILED", "DEAD"] }, updatedAt: { gte: daysAgo(1) } }, orderBy: { updatedAt: "desc" }, take: 15, select: { id: true, jobName: true, queue: true, status: true, lastError: true, attempts: true, updatedAt: true } }).catch(() => []);
      return {
        summary: rows.length ? `${rows.length} failed job runs in 24h: ${rows.map((r) => `${r.jobName} (${r.status}, ${r.attempts} attempts)`).join("; ")}` : "No failed job runs in the last 24 hours.",
        records: rows.map((r) => ({ label: `${r.jobName} · ${r.status}`, href: `/system/jobs?run=${r.id}`, detail: r.lastError?.slice(0, 120) })),
      };
    },
  },
  {
    name: "ai_failures",
    description: "Failed AI tasks of the last 7 days by error code, and AI request failures in the last 24 hours by provider.",
    perms: ["platform.ai.read", "platform.ai.manage"],
    async run() {
      const [byCode, byProvider] = await Promise.all([
        db().agentTask.groupBy({ by: ["errorCode"], where: { status: "FAILED", completedAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
        db().aiRequestLog.groupBy({ by: ["provider", "status"], where: { createdAt: { gte: daysAgo(1) }, status: { in: ["ERROR", "FALLBACK", "REFUSED"] } }, _count: { _all: true } }),
      ]);
      const codes = byCode.map((r) => ({ code: r.errorCode ?? "unknown", n: r._count._all })).sort((a, b) => b.n - a.n);
      return {
        summary: `Failed AI tasks (7d) by code: ${codes.map((c) => `${c.code} ${c.n}`).join(", ") || "none"}. Request failures (24h): ${byProvider.map((p) => `${p.provider} ${p.status} ${p._count._all}`).join(", ") || "none"}.`,
        records: [...codes.slice(0, 6).map((c) => ({ label: `Failed tasks: ${c.code}`, href: `/ai/tasks?status=FAILED&errorCode=${encodeURIComponent(c.code)}`, detail: String(c.n) })), { label: "AI requests with errors", href: "/ai/requests?status=ERROR" }],
      };
    },
  },
  {
    name: "top_ai_spenders",
    description: "Organizations with the highest AI spend in the last 30 days, from the cost ledger.",
    perms: ["platform.ai.read", "platform.ai.manage"],
    async run(ctx) {
      const { aiCostUsage } = await import("./ai");
      const u = await aiCostUsage(ctx, { days: 30 });
      const top = u.byOrg.slice(0, 10);
      return {
        summary: top.length ? `Top AI spenders (30d, cost ledger): ${top.map((o) => `${o.name} ${usd(o.costMicros)} (${o.calls} calls)`).join("; ")}` : "No AI spend recorded in the last 30 days.",
        records: top.map((o) => ({ label: o.name, href: `/organizations/${o.id}`, detail: usd(o.costMicros) })),
      };
    },
  },
  {
    name: "revenue",
    description: "Current MRR per currency and subscription counts by status (no live Stripe call).",
    perms: ["platform.subscriptions.read", "platform.subscriptions.manage"],
    async run() {
      const { mrrByCurrency } = await import("./overview");
      const [mrr, byStatus] = await Promise.all([mrrByCurrency(), db().subscription.groupBy({ by: ["status"], _count: { _all: true } })]);
      return {
        summary: `MRR: ${mrr.map((m) => money(m.amountMinor, m.currency)).join(", ") || "none"}. Subscriptions by status: ${byStatus.map((s) => `${s.status} ${s._count._all}`).join(", ") || "none"}.`,
        records: [{ label: "Revenue", href: "/revenue" }, { label: "Subscriptions", href: "/subscriptions" }],
      };
    },
  },
  {
    name: "past_due_subscriptions",
    description: "Subscriptions in PAST_DUE or UNPAID status, most recent payment failure first.",
    perms: ["platform.subscriptions.read", "platform.subscriptions.manage"],
    async run() {
      const rows = await db().subscription.findMany({ where: { status: { in: ["PAST_DUE", "UNPAID"] } }, orderBy: { lastPaymentFailedAt: { sort: "desc", nulls: "last" } }, take: 15, select: { id: true, status: true, organizationId: true, lastPaymentFailedAt: true, organization: { select: { name: true } } } });
      return {
        summary: rows.length ? `${rows.length} past-due or unpaid subscriptions: ${rows.map((r) => `${r.organization.name} (${r.status}${r.lastPaymentFailedAt ? `, last failure ${r.lastPaymentFailedAt.toISOString().slice(0, 10)}` : ""})`).join("; ")}` : "No past-due or unpaid subscriptions.",
        records: rows.map((r) => ({ label: `${r.organization.name} · ${r.status}`, href: `/plans/organizations/${r.organizationId}` })),
      };
    },
  },
  {
    name: "disconnected_integrations",
    description: "Integration connections in ERROR or DISCONNECTED status, by provider.",
    perms: ["platform.organizations.read", "platform.organizations.manage", "platform.security.read"],
    async run() {
      const rows = await db().integrationConnection.groupBy({ by: ["provider", "status"], where: { status: { in: ["ERROR", "DISCONNECTED"] } }, _count: { _all: true } });
      const sorted = rows.sort((a, b) => b._count._all - a._count._all);
      return {
        summary: sorted.length ? `Broken connections: ${sorted.map((r) => `${r.provider} ${r.status} ${r._count._all}`).join(", ")}` : "No integration connections in error or disconnected.",
        records: [{ label: "Integrations", href: "/integrations" }, ...sorted.slice(0, 8).map((r) => ({ label: `${r.provider} · ${r.status}`, href: `/integrations?provider=${encodeURIComponent(r.provider)}`, detail: String(r._count._all) }))],
      };
    },
  },
  {
    name: "inactive_users",
    description: "Active users without any session activity in the last 30 days (count and the most recent sign-ups among them).",
    perms: ["platform.users.read", "platform.users.manage"],
    async run() {
      const since = daysAgo(30);
      const where: Prisma.UserWhereInput = { status: "ACTIVE", sessions: { none: { lastSeenAt: { gte: since } } } };
      const [n, sample] = await Promise.all([db().user.count({ where }), db().user.findMany({ where, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, name: true } })]);
      return { summary: `${n} active users had no session activity in the last 30 days.`, records: [{ label: "Users not seen in 30 days", href: "/users?login=30d" }, ...sample.map((u) => ({ label: u.name || u.id.slice(0, 8), href: `/users/${u.id}` }))] };
    },
  },
  {
    name: "incidents",
    description: "Open platform incidents.",
    perms: ["platform.incidents.read", "platform.incidents.manage"],
    async run() {
      // The incidents module (stream E) owns the source; until its table exists this tool reports the gap.
      const exists = await db().$queryRaw<{ t: string | null }[]>(Prisma.sql`SELECT to_regclass('public.platform_incidents')::text AS t`).catch(() => [{ t: null }]);
      if (!exists[0]?.t) return { summary: "Incidents are not yet tracked on this platform (no incidents table).", records: [{ label: "Incidents", href: "/incidents" }], unavailable: "Not yet tracked" };
      const rows = await db().$queryRaw<{ id: string; title: string; status: string; severity: string }[]>(Prisma.sql`SELECT id::text, title, status::text, severity::text FROM platform_incidents WHERE status::text NOT IN ('RESOLVED','CLOSED') ORDER BY created_at DESC LIMIT 10`).catch(() => null);
      if (!rows) return { summary: "The incidents source could not be read.", records: [{ label: "Incidents", href: "/incidents" }], unavailable: "Unavailable" };
      return { summary: rows.length ? `${rows.length} open incidents: ${rows.map((r) => `${r.title} (${r.severity}, ${r.status})`).join("; ")}` : "No open incidents.", records: rows.map((r) => ({ label: r.title, href: `/incidents/${r.id}`, detail: `${r.severity} · ${r.status}` })) };
    },
  },
];

/** Tools this admin may use (permission-aware). */
export async function toolsFor(ctx: RequestContext): Promise<CopilotTool[]> {
  const chain = platformChain();
  const out: CopilotTool[] = [];
  for (const t of COPILOT_TOOLS) {
    for (const p of t.perms) {
      if (await can(ctx, p, chain)) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}
