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

export const taskSearchInput = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum(AGENT_TASK_STATUSES).optional().catch(undefined),
  profile: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  errorCode: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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

/** Cost and usage monitoring: tokens and estimated cost by organization, model and day. */
export async function aiCostUsage(ctx: RequestContext, raw: z.input<typeof usageInput> = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const { days } = usageInput.parse(raw);
  const since = daysAgo(days);
  const [byOrgModel, byDayModel] = await Promise.all([
    db().agentTask.groupBy({ by: ["organizationId", "model"], where: { startedAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    db().$queryRaw<{ day: Date; model: string | null; input: bigint | null; output: bigint | null; tasks: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', started_at) AS day, model, SUM(input_tokens)::bigint AS input, SUM(output_tokens)::bigint AS output, COUNT(*)::bigint AS tasks
      FROM agent_tasks WHERE started_at >= ${since} GROUP BY 1, 2 ORDER BY 1 DESC`),
  ]);
  const orgMap = new Map<string, { tokens: number; costMicros: number; tasks: number }>();
  const modelMap = new Map<string, { tokens: number; costMicros: number; tasks: number }>();
  for (const r of byOrgModel) {
    const i = r._sum.inputTokens ?? 0;
    const o = r._sum.outputTokens ?? 0;
    const c = costMicros(r.model, i, o);
    for (const [map, key] of [[orgMap, r.organizationId], [modelMap, r.model ?? "unknown"]] as const) {
      const cur = map.get(key) ?? { tokens: 0, costMicros: 0, tasks: 0 };
      map.set(key, { tokens: cur.tokens + i + o, costMicros: cur.costMicros + c, tasks: cur.tasks + r._count._all });
    }
  }
  const dayMap = new Map<string, { tokens: number; costMicros: number; tasks: number }>();
  for (const r of byDayModel) {
    const key = r.day.toISOString().slice(0, 10);
    const i = Number(r.input ?? 0);
    const o = Number(r.output ?? 0);
    const cur = dayMap.get(key) ?? { tokens: 0, costMicros: 0, tasks: 0 };
    dayMap.set(key, { tokens: cur.tokens + i + o, costMicros: cur.costMicros + costMicros(r.model, i, o), tasks: cur.tasks + Number(r.tasks) });
  }
  const topOrgs = [...orgMap].sort((a, b) => b[1].costMicros - a[1].costMicros).slice(0, 25);
  const names = await db().organization.findMany({ where: { id: { in: topOrgs.map(([id]) => id) } }, select: { id: true, name: true } });
  return {
    days,
    byOrg: topOrgs.map(([id, v]) => ({ id, name: names.find((n) => n.id === id)?.name ?? id, ...v })),
    byModel: [...modelMap].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costMicros - a.costMicros),
    byDay: [...dayMap].map(([day, v]) => ({ day, ...v })),
  };
}
