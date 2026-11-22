import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { notFound } from "@/server/core/errors";
import { prismaPage, toPage } from "@/server/core/pagination";
import { agentModel, getControls } from "@/server/core/platform-controls";
import { cancelTask, retryTask } from "@/server/modules/agents/service";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { AGENT_TASK_STATUSES } from "@/server/modules/agents/statuses";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { MODEL_PRICES, costMicros } from "@/server/modules/workforce/pricing";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform, utcMonthStart } from "./access";
import { aiUsageSince } from "./overview";

const AI_READ = ["platform.ai.read", "platform.ai.manage"];

/** AI Control Center overview: workforce across organizations, roles, models, provider and usage. */
export async function aiOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, AI_READ);
  const d30 = daysAgo(30);
  const [employees, statusCounts, byProfile, byModel, month, today, controls, model] = await Promise.all([
    db().aiEmployee.groupBy({ by: ["status"], where: { archivedAt: null }, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(1) } }, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["profile"], where: { createdAt: { gte: d30 } }, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["model"], where: { startedAt: { gte: d30 } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    aiUsageSince(utcMonthStart()),
    aiUsageSince(new Date(new Date().setUTCHours(0, 0, 0, 0))),
    getControls(),
    agentModel(env().AGENT_MODEL),
  ]);
  const profiles = AGENT_PROFILES.map((p) => ({
    key: p.key,
    department: p.department ?? "general",
    tools: p.tools.length,
    tasks30d: byProfile.find((b) => b.profile === p.key)?._count._all ?? 0,
    disabled: controls.aiDisabledProfiles.includes(p.key),
  }));
  const knownModels = [...new Set([...Object.keys(MODEL_PRICES), ...byModel.map((m) => m.model).filter((m): m is string => !!m), env().AGENT_MODEL])].sort();
  return {
    provider: { configured: aiConfigured(), envModel: env().AGENT_MODEL, effectiveModel: model, dailyTokenLimitPerCompany: env().AI_DAILY_TOKEN_LIMIT || null },
    employees: { active: employees.find((e) => e.status === "ACTIVE")?._count._all ?? 0, paused: employees.find((e) => e.status === "PAUSED")?._count._all ?? 0 },
    tasks24h: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])) as Partial<Record<string, number>>,
    profiles,
    models: knownModels.map((m) => {
      const u = byModel.find((b) => b.model === m);
      const i = u?._sum.inputTokens ?? 0;
      const o = u?._sum.outputTokens ?? 0;
      return { id: m, tasks30d: u?._count._all ?? 0, tokens30d: i + o, costMicros30d: costMicros(m, i, o), disabled: controls.aiDisabledModels.includes(m), allowed: controls.aiAllowedModels.length === 0 || controls.aiAllowedModels.includes(m) };
    }),
    usage: { month, today },
    controls,
  };
}

/** Task statuses the admin filters on (the tenant list plus PAUSED, which only platform admins set). */
export const ADMIN_TASK_STATUSES = [...AGENT_TASK_STATUSES, "PAUSED"] as const;

export const taskSearchInput = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum(ADMIN_TASK_STATUSES).optional().catch(undefined),
  profile: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  errorCode: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  employee: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** AI task logs across organizations: search by id or title, filter by status, role, organization or error. */
export async function searchTasks(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof taskSearchInput>, unknown>> = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const f = taskSearchInput.parse(raw);
  const where: Prisma.AgentTaskWhereInput = {
    ...(f.q ? (isUuid(f.q) ? { id: f.q } : { title: { contains: f.q, mode: "insensitive" } }) : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.profile ? { profile: f.profile } : {}),
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.errorCode ? { errorCode: f.errorCode } : {}),
    ...(f.employee ? { aiEmployeeId: f.employee } : {}),
  };
  const rows = await db().agentTask.findMany({
    where,
    orderBy: { id: "desc" },
    ...prismaPage({ limit: f.limit, cursor: f.cursor }),
    select: { id: true, organizationId: true, companyId: true, profile: true, title: true, status: true, model: true, inputTokens: true, outputTokens: true, attempts: true, errorCode: true, errorMessage: true, createdAt: true, startedAt: true, completedAt: true, company: { select: { name: true } } },
  });
  const page = toPage(rows, { limit: f.limit, cursor: f.cursor });
  const orgs = await db().organization.findMany({ where: { id: { in: [...new Set(page.data.map((t) => t.organizationId))] } }, select: { id: true, name: true } });
  return { ...page, data: page.data.map((t) => ({ ...t, organizationName: orgs.find((o) => o.id === t.organizationId)?.name ?? "" })) };
}

/** Failure summary: error codes over the last 7 days. */
export async function failureSummary(ctx: RequestContext) {
  await requireAnyPlatform(ctx, AI_READ);
  const rows = await db().agentTask.groupBy({ by: ["errorCode"], where: { status: "FAILED", completedAt: { gte: daysAgo(7) } }, _count: { _all: true } });
  return rows.map((r) => ({ errorCode: r.errorCode ?? "unknown", count: r._count._all })).sort((a, b) => b.count - a.count);
}

export const taskActionInput = z.object({ reason: reasonSchema });

/** Cancel or retry any organization's task through the agents service (system principal), audited as the admin. */
export async function adminTaskAction(ctx: RequestContext, taskId: string, action: "cancel" | "retry", raw: z.input<typeof taskActionInput>) {
  const { reason } = taskActionInput.parse(raw);
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  if (!isUuid(taskId)) throw notFound("Task");
  const task = await db().agentTask.findUnique({ where: { id: taskId }, select: { organizationId: true, companyId: true, status: true } });
  if (!task) throw notFound("Task");
  const sys = systemContext(ctx.requestId);
  if (action === "cancel") await cancelTask(sys, task.organizationId, task.companyId, taskId);
  else await retryTask(sys, task.organizationId, task.companyId, taskId);
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "ADMIN", organizationId: task.organizationId, action: `platform.ai.task_${action === "cancel" ? "cancelled" : "retried"}`, resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status }, reason }),
  );
  return { ok: true };
}

const usageInput = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

type UsageAgg = { tokens: number; cachedTokens: number; costMicros: number; calls: number };
interface LedgerGroupRow {
  key: string | null;
  tokens: bigint | null;
  cached: bigint | null;
  cost: bigint | null;
  calls: bigint;
}

const usageCache = new Map<number, { at: number; value: Awaited<ReturnType<typeof computeCostUsage>> }>();

async function computeCostUsage(days: number) {
  const since = daysAgo(days);
  const group = (col: Prisma.Sql) =>
    db().$queryRaw<LedgerGroupRow[]>(Prisma.sql`
      SELECT ${col} AS key, SUM(input_tokens + output_tokens + cached_tokens + cache_write_tokens)::bigint AS tokens,
        SUM(cached_tokens)::bigint AS cached, SUM(cost_micros)::bigint AS cost, COUNT(*)::bigint AS calls
      FROM cost_ledger_entries WHERE category = 'AI_TOKENS' AND occurred_at >= ${since}
      GROUP BY 1 ORDER BY cost DESC NULLS LAST LIMIT 100`);
  const [byOrg, byModel, byProvider, byOperation, byDepartment, byDay] = await Promise.all([
    group(Prisma.sql`organization_id::text`),
    group(Prisma.sql`COALESCE(model, 'unknown')`),
    group(Prisma.sql`provider`),
    group(Prisma.sql`operation`),
    group(Prisma.sql`COALESCE(department, 'none')`),
    db().$queryRaw<LedgerGroupRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS key, SUM(input_tokens + output_tokens + cached_tokens + cache_write_tokens)::bigint AS tokens,
        SUM(cached_tokens)::bigint AS cached, SUM(cost_micros)::bigint AS cost, COUNT(*)::bigint AS calls
      FROM cost_ledger_entries WHERE category = 'AI_TOKENS' AND occurred_at >= ${since} GROUP BY 1 ORDER BY 1 DESC`),
  ]);
  const agg = (r: LedgerGroupRow): UsageAgg => ({ tokens: Number(r.tokens ?? 0), cachedTokens: Number(r.cached ?? 0), costMicros: Number(r.cost ?? 0), calls: Number(r.calls) });
  const topOrgs = byOrg.slice(0, 25);
  const names = await db().organization.findMany({ where: { id: { in: topOrgs.map((r) => r.key!).filter(Boolean) } }, select: { id: true, name: true } });
  return {
    days,
    source: "cost_ledger_entries" as const,
    computedAt: new Date().toISOString(),
    byOrg: topOrgs.map((r) => ({ id: r.key!, name: names.find((n) => n.id === r.key)?.name ?? r.key!.slice(0, 8), ...agg(r) })),
    byModel: byModel.map((r) => ({ model: r.key ?? "unknown", ...agg(r) })),
    byProvider: byProvider.map((r) => ({ provider: r.key ?? "unknown", ...agg(r) })),
    byOperation: byOperation.map((r) => ({ operation: r.key ?? "unknown", ...agg(r) })),
    byDepartment: byDepartment.map((r) => ({ department: r.key ?? "none", ...agg(r) })),
    byDay: byDay.map((r) => ({ day: r.key!, ...agg(r) })),
  };
}

/**
 * Cost and usage monitoring from the cost ledger (`cost_ledger_entries`, category AI_TOKENS): one row per real model
 * call (agent turns, quick calls, Voice OS), cache-aware cost, by organization, model, provider, operation,
 * department and day. Cached 60 s per window.
 */
export async function aiCostUsage(ctx: RequestContext, raw: z.input<typeof usageInput> = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const { days } = usageInput.parse(raw);
  const hit = usageCache.get(days);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = await computeCostUsage(days);
  usageCache.set(days, { at: Date.now(), value });
  return value;
}
