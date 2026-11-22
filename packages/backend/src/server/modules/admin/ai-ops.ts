import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { getControls } from "@/server/core/platform-controls";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { archiveEmployee, setEmployeeStatus, updateEmployee, updateEmployeeInput } from "@/server/modules/workforce/service";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { capabilitiesFor, daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, utcMonthStart } from "./access";

/**
 * AI operations extras (stream C; split out of ops.ts in Step 0):
 *  - AI routing: fallback chain + credit cost per model (platform settings);
 *  - AI error management;
 *  - AI employees: model / tools / budget / autonomy / pause through the workforce service (system principal).
 */

// ───────────── AI routing: fallback chain & credits ─────────────

const FALLBACK_KEY = "ai:fallbackChain";
const CREDITS_KEY = "ai:modelCredits";
const modelId = z.string().regex(/^[a-z0-9.@-]{3,64}$/);
const creditSchema = z.record(z.string(), z.object({ input: z.number().min(0).max(1e6), output: z.number().min(0).max(1e6) }));

async function setting<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  const row = await db().platformSetting.findUnique({ where: { key } }).catch(() => null);
  const p = schema.safeParse(row?.value);
  return p.success ? p.data : fallback;
}

/** Ordered fallback models (used when the primary model is unavailable) and credits per 1M tokens per model. */
export async function aiRouting(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const [chain, credits] = await Promise.all([setting(FALLBACK_KEY, z.array(modelId).max(5), [] as string[]), setting(CREDITS_KEY, creditSchema, {})]);
  return { fallbackChain: chain, credits };
}

/** The fallback chain for runtime use (agents hook): models after the primary, skipping disabled ones. */
export async function fallbackModels(primary: string): Promise<string[]> {
  const [chain, c] = await Promise.all([setting(FALLBACK_KEY, z.array(modelId).max(5), [] as string[]), getControls()]);
  return chain.filter((m) => m !== primary && !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m)));
}

export const aiRoutingInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fallback"), chain: z.array(modelId).max(5), reason: reasonSchema }),
  z.object({ action: z.literal("credits"), model: modelId, input: z.number().min(0).max(1e6).nullable(), output: z.number().min(0).max(1e6).nullable(), reason: reasonSchema }),
]);

export async function updateAiRouting(ctx: RequestContext, raw: z.input<typeof aiRoutingInput>) {
  const input = aiRoutingInput.parse(raw);
  const known = new Set(Object.keys(MODEL_PRICES));
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    let key: string;
    let value: unknown;
    let before: unknown;
    if (input.action === "fallback") {
      const unknown = input.chain.filter((m) => !known.has(m) && !/^[a-z]+\.anthropic\./.test(m));
      if (unknown.length) throw conflict(`Unknown model: ${unknown.join(", ")}`);
      key = FALLBACK_KEY;
      before = await setting(FALLBACK_KEY, z.array(modelId), []);
      value = [...new Set(input.chain)];
    } else {
      key = CREDITS_KEY;
      const cur = await setting(CREDITS_KEY, creditSchema, {});
      before = cur[input.model] ?? null;
      const next = { ...cur };
      if (input.input === null || input.output === null) delete next[input.model];
      else next[input.model] = { input: input.input, output: input.output };
      value = next;
    }
    const json = toJson(value) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: json, updatedById: ctx.actor.id, reason: input.reason }, update: { value: json, updatedById: ctx.actor.id, reason: input.reason } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: input.action === "fallback" ? "platform.ai.fallback_changed" : "platform.ai.credits_changed", resourceType: "platform_control", resourceId: key, oldValue: before, newValue: input.action === "fallback" ? value : { [input.model]: input.input === null ? null : { input: input.input, output: input.output } }, reason: input.reason });
    return { ok: true };
  });
}

/** AI error management: failures by code, role and organization (7 days) and the latest failed tasks. */
export async function aiErrors(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const since = daysAgo(7);
  const where = { status: "FAILED" as const, completedAt: { gte: since } };
  const [byCode, byProfile, byOrg, latest, total, completed] = await Promise.all([
    db().agentTask.groupBy({ by: ["errorCode"], where, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["profile"], where, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["organizationId"], where, _count: { _all: true }, orderBy: { _count: { organizationId: "desc" } }, take: 15 }),
    db().agentTask.findMany({ where, orderBy: { completedAt: "desc" }, take: 30, select: { id: true, organizationId: true, title: true, profile: true, errorCode: true, errorMessage: true, attempts: true, completedAt: true } }),
    db().agentTask.count({ where }),
    db().agentTask.count({ where: { completedAt: { gte: since } } }),
  ]);
  const orgs = await db().organization.findMany({ where: { id: { in: [...new Set([...byOrg.map((o) => o.organizationId), ...latest.map((l) => l.organizationId)])] } }, select: { id: true, name: true } });
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  return {
    total,
    rate: completed ? total / completed : null,
    byCode: byCode.map((r) => ({ code: r.errorCode ?? "unknown", count: r._count._all })).sort((a, b) => b.count - a.count),
    byProfile: byProfile.map((r) => ({ profile: r.profile, count: r._count._all })).sort((a, b) => b.count - a.count),
    byOrg: byOrg.map((r) => ({ id: r.organizationId, name: orgName(r.organizationId), count: r._count._all })),
    latest: latest.map((l) => ({ ...l, organizationName: orgName(l.organizationId) })),
  };
}

// ───────────── AI employee administration ─────────────

export const employeeAdminInput = z.object({
  model: z.string().regex(/^[a-z0-9.-]{3,64}$/).nullable().optional(),
  autonomy: updateEmployeeInput.shape.autonomy,
  monthlyTokenBudget: updateEmployeeInput.shape.monthlyTokenBudget,
  monthlyCostBudgetCents: updateEmployeeInput.shape.monthlyCostBudgetCents,
  allowedTools: updateEmployeeInput.shape.allowedTools,
  instructions: updateEmployeeInput.shape.instructions,
  skills: updateEmployeeInput.shape.skills,
  jobTitle: updateEmployeeInput.shape.jobTitle,
  managerEmployeeId: updateEmployeeInput.shape.managerEmployeeId,
  runsAsUserId: updateEmployeeInput.shape.runsAsUserId,
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  reason: reasonSchema,
});

export async function getEmployeeAdmin(ctx: RequestContext, employeeId: string) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({
    where: { id: employeeId },
    select: { id: true, organizationId: true, companyId: true, name: true, profileKey: true, department: true, status: true, autonomy: true, level: true, jobTitle: true, model: true, allowedTools: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true, archivedAt: true, createdAt: true },
  });
  if (!e) throw notFound("AI employee");
  const profile = AGENT_PROFILES.find((p) => p.key === e.profileKey);
  const [org, company] = await Promise.all([db().organization.findUnique({ where: { id: e.organizationId }, select: { name: true } }), db().company.findUnique({ where: { id: e.companyId }, select: { name: true } })]);
  return { ...e, organizationName: org?.name ?? "", companyName: company?.name ?? "", profileTools: profile ? [...profile.tools] : [] };
}

/** Change model / tools / budgets / autonomy / status of any AI employee via the workforce service, audited as the admin. */
export async function updateEmployeeAdmin(ctx: RequestContext, employeeId: string, raw: z.input<typeof employeeAdminInput>) {
  const { reason, status, ...changes } = employeeAdminInput.parse(raw);
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({ where: { id: employeeId }, select: { organizationId: true, companyId: true, model: true, autonomy: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true, allowedTools: true, status: true, instructions: true, skills: true, jobTitle: true, managerEmployeeId: true, runsAsUserId: true } });
  if (!e) throw notFound("AI employee");
  const sys = systemContext(ctx.requestId);
  const fields = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length) await updateEmployee(sys, e.organizationId, e.companyId, employeeId, fields);
  if (status && status !== e.status) await setEmployeeStatus(sys, e.organizationId, e.companyId, employeeId, { status });
  await transaction((tx) =>
    writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: e.organizationId,
      action: "platform.ai.employee_updated",
      resourceType: "ai_employee",
      resourceId: employeeId,
      oldValue: {
        model: e.model,
        autonomy: e.autonomy,
        monthlyTokenBudget: e.monthlyTokenBudget,
        monthlyCostBudgetCents: e.monthlyCostBudgetCents?.toString() ?? null,
        allowedTools: e.allowedTools,
        status: e.status,
        ...("instructions" in fields ? { instructionsLength: e.instructions?.length ?? 0 } : {}),
        ...("skills" in fields ? { skills: e.skills } : {}),
        ...("jobTitle" in fields ? { jobTitle: e.jobTitle } : {}),
        ...("managerEmployeeId" in fields ? { managerEmployeeId: e.managerEmployeeId } : {}),
        ...("runsAsUserId" in fields ? { runsAsUserId: e.runsAsUserId } : {}),
      },
      // Instructions are tenant content: the audit keeps their length, not the text.
      newValue: { ...fields, ...("instructions" in fields ? { instructions: undefined, instructionsLength: typeof fields.instructions === "string" ? fields.instructions.length : 0 } : {}), ...(status ? { status } : {}) },
      reason,
    }),
  );
  return { ok: true };
}

/**
 * AI employee detail (Admin → AI → Workforce → employee): identity, role, model, autonomy, budgets, the month's
 * tasks and cost (cost ledger), schedules, memory, role assignments of its agent principal, org chart and the
 * request-log health of its calls. Instructions and memory text are tenant content: shown with platform.data.read
 * or platform.ai.manage (who can edit them); otherwise only counts.
 */
export async function getEmployeeDetail(ctx: RequestContext, employeeId: string) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({ where: { id: employeeId } });
  if (!e) throw notFound("AI employee");
  const caps = await capabilitiesFor(ctx, ["platform.data.read", "platform.ai.manage"]);
  const content = caps["platform.data.read"] || caps["platform.ai.manage"];
  const month = utcMonthStart();
  const [org, company, manager, reports, tasksByStatus, recentTasks, costMonth, schedules, memoryCount, memories, roleAssignments, roleProfile, requests7d, runsAs, peers] = await Promise.all([
    db().organization.findUnique({ where: { id: e.organizationId }, select: { id: true, name: true, status: true } }),
    db().company.findUnique({ where: { id: e.companyId }, select: { id: true, name: true } }),
    e.managerEmployeeId ? db().aiEmployee.findUnique({ where: { id: e.managerEmployeeId }, select: { id: true, name: true } }) : null,
    db().aiEmployee.findMany({ where: { managerEmployeeId: e.id, archivedAt: null }, select: { id: true, name: true, status: true }, take: 50 }),
    db().agentTask.groupBy({ by: ["status"], where: { aiEmployeeId: e.id, createdAt: { gte: month } }, _count: { _all: true } }),
    db().agentTask.findMany({ where: { aiEmployeeId: e.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, createdAt: true, completedAt: true, errorCode: true, inputTokens: true, outputTokens: true, model: true } }),
    db().costLedgerEntry.aggregate({ where: { organizationId: e.organizationId, companyId: e.companyId, aiEmployeeId: e.id, occurredAt: { gte: month } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    db().aiSchedule.findMany({ where: { aiEmployeeId: e.id, companyId: e.companyId }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, name: true, kind: true, frequency: true, timeOfDay: true, eventType: true, enabled: true, lastRunAt: true, runCount: true } }),
    db().aiEmployeeMemory.count({ where: { aiEmployeeId: e.id, companyId: e.companyId } }),
    db().aiEmployeeMemory.findMany({ where: { aiEmployeeId: e.id, companyId: e.companyId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 50, select: { id: true, content: true, source: true, pinned: true, createdAt: true, sourceTaskId: true } }),
    db().roleAssignment.findMany({ where: { principalType: "AGENT", principalId: e.id }, select: { id: true, scopeType: true, scopeId: true, expiresAt: true, role: { select: { key: true, name: true } } } }),
    e.profileKey.startsWith("custom_") ? db().aiRoleProfile.findFirst({ where: { companyId: e.companyId, key: e.profileKey }, select: { id: true, name: true, department: true, instructions: true, tools: true, maxTurns: true, archivedAt: true } }) : null,
    db().aiRequestLog.groupBy({ by: ["status"], where: { aiEmployeeId: e.id, createdAt: { gte: daysAgo(7) } }, _count: { _all: true }, _sum: { costMicros: true } }),
    e.runsAsUserId ? db().user.findUnique({ where: { id: e.runsAsUserId }, select: { id: true, name: true, email: true } }) : null,
    db().aiEmployee.findMany({ where: { companyId: e.companyId, archivedAt: null, NOT: { id: e.id } }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } }),
  ]);
  const builtIn = AGENT_PROFILES.find((p) => p.key === e.profileKey);
  return {
    id: e.id,
    name: e.name,
    initials: e.initials,
    profileKey: e.profileKey,
    department: e.department,
    status: e.status,
    archivedAt: e.archivedAt,
    autonomy: e.autonomy,
    level: e.level,
    jobTitle: e.jobTitle,
    model: e.model,
    skills: e.skills,
    allowedTools: e.allowedTools,
    profileTools: builtIn ? [...builtIn.tools] : (roleProfile?.tools ?? []),
    monthlyTokenBudget: e.monthlyTokenBudget,
    monthlyCostBudgetCents: e.monthlyCostBudgetCents?.toString() ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    setupCompletedAt: e.setupCompletedAt,
    lastEvaluatedAt: e.lastEvaluatedAt,
    organization: org ?? { id: e.organizationId, name: e.organizationId.slice(0, 8), status: "ACTIVE" as const },
    company: company ?? { id: e.companyId, name: e.companyId.slice(0, 8) },
    manager,
    managerUserId: e.managerUserId,
    reports,
    peers,
    runsAs: runsAs ? { id: runsAs.id, name: runsAs.name, email: caps["platform.data.read"] ? runsAs.email : null } : null,
    content,
    instructions: content ? e.instructions : null,
    instructionsLength: e.instructions?.length ?? 0,
    roleProfile: roleProfile ? { ...roleProfile, instructions: content ? roleProfile.instructions : null } : null,
    builtInProfile: !!builtIn,
    tasksMonth: Object.fromEntries(tasksByStatus.map((t) => [t.status, t._count._all])) as Partial<Record<string, number>>,
    recentTasks,
    costMonth: { micros: Number(costMonth._sum.costMicros ?? 0n), tokens: (costMonth._sum.inputTokens ?? 0) + (costMonth._sum.outputTokens ?? 0), calls: costMonth._count._all },
    schedules,
    memory: { count: memoryCount, items: memories.map((m) => ({ ...m, content: content ? m.content : null })) },
    roleAssignments,
    requests7d: requests7d.map((r) => ({ status: r.status, count: r._count._all, costMicros: Number(r._sum.costMicros ?? 0n) })),
    canManage: caps["platform.ai.manage"],
  };
}

export const employeeLifecycleInput = z.object({ action: z.enum(["archive", "restore"]), reason: reasonSchema, confirm: z.string().optional() });

/**
 * Disable (archive: soft, task history kept, schedules disabled, reports move up) or re-enable (restore: back,
 * paused, so a person resumes it deliberately; schedules stay disabled) an AI employee. Archive needs the typed name.
 */
export async function employeeLifecycle(ctx: RequestContext, employeeId: string, raw: z.input<typeof employeeLifecycleInput>) {
  const input = employeeLifecycleInput.parse(raw);
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({ where: { id: employeeId }, select: { organizationId: true, companyId: true, name: true, archivedAt: true, status: true } });
  if (!e) throw notFound("AI employee");
  if (input.action === "archive") {
    if (e.archivedAt) throw conflict("Already disabled", { reason: "employee_archived" });
    requireConfirmation(input.confirm, e.name);
    await archiveEmployee(systemContext(ctx.requestId), e.organizationId, e.companyId, employeeId);
  } else {
    if (!e.archivedAt) throw conflict("This AI employee is not disabled", { reason: "employee_not_archived" });
    await db().aiEmployee.updateMany({ where: { id: employeeId, archivedAt: { not: null } }, data: { archivedAt: null, status: "PAUSED" } });
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "ADMIN", organizationId: e.organizationId, action: input.action === "archive" ? "platform.ai.employee_disabled" : "platform.ai.employee_enabled", resourceType: "ai_employee", resourceId: employeeId, oldValue: { archivedAt: e.archivedAt, status: e.status }, newValue: { archived: input.action === "archive" }, reason: input.reason }),
  );
  return { ok: true };
}

export const employeeMemoryInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), memoryId: z.string().uuid(), reason: reasonSchema }),
  z.object({ action: z.literal("purge"), reason: reasonSchema, confirm: z.string().optional() }),
]);

/** Delete one memory note or purge all of an AI employee's memory (typed confirmation), audited (counts, not text). */
export async function employeeMemoryAdmin(ctx: RequestContext, employeeId: string, raw: z.input<typeof employeeMemoryInput>) {
  const input = employeeMemoryInput.parse(raw);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    const e = await tx.aiEmployee.findUnique({ where: { id: employeeId }, select: { organizationId: true, companyId: true, name: true } });
    if (!e) throw notFound("AI employee");
    let removed: number;
    if (input.action === "delete") {
      removed = (await tx.aiEmployeeMemory.deleteMany({ where: { id: input.memoryId, aiEmployeeId: employeeId, companyId: e.companyId } })).count;
      if (!removed) throw notFound("Memory");
    } else {
      requireConfirmation(input.confirm, "PURGE");
      removed = (await tx.aiEmployeeMemory.deleteMany({ where: { aiEmployeeId: employeeId, companyId: e.companyId } })).count;
    }
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: e.organizationId, action: input.action === "delete" ? "platform.ai.employee_memory_deleted" : "platform.ai.employee_memory_purged", resourceType: "ai_employee", resourceId: employeeId, newValue: { removed, ...(input.action === "delete" ? { memoryId: input.memoryId } : {}) }, reason: input.reason });
    return { removed };
  });
}
