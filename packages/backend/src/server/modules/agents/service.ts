import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { enqueueAgentTask } from "@/server/core/jobs";
import { env } from "@/server/core/env";
import { aiRefusal, aiRefusalMessage, assertAiAllowed, assertProfileAllowed, isOrganizationSuspended } from "@/server/core/platform-controls";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { AUTONOMY_GUIDANCE, toolsForAutonomy } from "@/server/modules/workforce/autonomy";
import { assertEmployeeBudget, budgetRefusal, employeeBudget } from "@/server/modules/workforce/budgets";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";
import { assertLimit, creditsForTokens, recordUsage } from "@/server/modules/entitlements/service";
import { platformBudgetRefusal, resolvePlatformModel } from "@/server/modules/admin/ai-models";
import { AGENT_TASK_STATUSES } from "./statuses";
import { PROFILE_KEYS } from "./profiles";
import { isCustomRoleKey, resolveProfile } from "./role-profiles";
import { aiConfigured, ParkRun, REMEMBER_LINE, runTask, TaskError, type ParkedRun } from "./runtime";
import { autopilotGate, inferTrigger, isProactive, logAutopilotRun, proactiveTriggerOf, type WorkTrigger } from "@/server/modules/autopilot/gate";
import { assertSpendAllowed, checkSpend } from "@/server/modules/costs/service";

export const createTaskInput = z.object({
  /** Optional milestone (same company) the task advances. */
  milestoneId: z.string().uuid().optional(),
  /** Optional CRM lead (same company) the task is about. */
  leadId: z.string().uuid().optional(),
  /** Optional generic subject (module record) the task is about, e.g. { type: "invoice", id }. */
  subject: z.object({ type: z.string().regex(/^[a-z_]{2,40}$/), id: z.string().uuid() }).optional(),
  /** Role profile (built-in, or the company's own `custom_*` role); optional when an AI employee is given (its profile is used). */
  profile: z
    .string()
    .regex(/^[a-z][a-z_]{1,59}$/)
    .refine((k) => (PROFILE_KEYS as readonly string[]).includes(k) || isCustomRoleKey(k), "Unknown role")
    .optional(),
  /** Optional AI employee (same company, active, within budget) that does the work. */
  aiEmployeeId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(8000),
}).refine((v) => v.profile || v.aiEmployeeId, { path: ["profile"], message: "Choose an AI employee or a role" });

/** Delegated tasks may nest at most this deep (a person's task is depth 0). */
export const MAX_DELEGATION_DEPTH = 2;
/** Park-on-approval (B27): a task parks at most this many times; afterwards it finishes and lists pending approvals. */
export const MAX_PARKS = 3;
/** A parked task whose approvals are not all decided after this long fails (approvals expire after 72 h). */
export const PARK_TIMEOUT_MS = 4 * 24 * 60 * 60_000;

/** Task resume state (agent_tasks.resume_state): the park opt-in, park count and the parked conversation. */
export interface ResumeState {
  parkOnApproval?: boolean;
  parks?: number;
  parked?: ParkedRun | null;
}
export const resumeStateOf = (v: unknown): ResumeState => (v && typeof v === "object" && !Array.isArray(v) ? (v as ResumeState) : {});
/** Memory notes included in an AI employee's prompt (pinned first, then newest). */
export const MEMORY_IN_PROMPT = 12;

export const taskFilters = z.object({
  aiEmployeeId: z.string().uuid().optional().catch(undefined),
  status: z.enum(AGENT_TASK_STATUSES).optional().catch(undefined),
  profile: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  subjectType: z.string().regex(/^[a-z_]{2,40}$/).optional().catch(undefined),
  parentTaskId: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});
export type TaskFilters = z.infer<typeof taskFilters>;

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
/** Cancellable states: queued, running, or parked waiting for approvals (B27). */
const ACTIVE = ["QUEUED", "RUNNING", "WAITING_APPROVAL"] as const;

/** Columns for lists: everything but the (potentially long) output and traces. */
const summaryFields = {
  id: true,
  companyId: true,
  profile: true,
  title: true,
  milestoneId: true,
  leadId: true,
  subjectType: true,
  subjectId: true,
  aiEmployeeId: true,
  parentTaskId: true,
  depth: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  status: true,
  attempts: true,
  errorCode: true,
  createdById: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.AgentTaskSelect;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.run", tx?: Prisma.TransactionClient) {
  // Foreign or invisible companies resolve to not_found.
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

function requireProvider() {
  if (!aiConfigured()) throw new AppError("not_configured", "No AI provider is configured (Anthropic, OpenAI or Gemini platform key)", { reason: "ai_not_configured" });
}

/** Start of the current UTC day. */
const utcDayStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Tokens a company's AI tasks used today (input + output), and its daily allowance (null = unlimited). */
export async function aiUsageToday(organizationId: string, companyId: string) {
  const limit = env().AI_DAILY_TOKEN_LIMIT || null;
  const r = await db().agentTask.aggregate({
    where: { organizationId, companyId, startedAt: { gte: utcDayStart() } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const used = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
  return { used, limit, exhausted: limit !== null && used >= limit };
}

async function requireBudget(organizationId: string, companyId: string, profile?: string | null) {
  // Platform AI controls first (Admin → AI & Workforce): kill switch, org AI switch, disabled role/model, platform and
  // per-organization token budgets and the plan's monthly AI tokens.
  await assertAiAllowed(organizationId, { profile, model: await resolvePlatformModel({ organizationId, profile }) });
  // Platform-wide monthly AI spend cap (Admin → AI).
  const platformBudget = await platformBudgetRefusal();
  if (platformBudget) throw new AppError("not_available", "The platform's monthly AI budget is used up; try again later", { reason: platformBudget });
  const usage = await aiUsageToday(organizationId, companyId);
  if (usage.exhausted) throw new AppError("not_available", "Today's AI allowance for this company is used up; try again tomorrow", { reason: "ai_budget_exhausted", ...usage });
  // Organization-wide daily AI token limit (Settings → Usage).
  const { assertWithinLimit } = await import("@/server/modules/enterprise/policy");
  await assertWithinLimit(organizationId, "aiTokens", { companyId });
}

const jobIdFor = (taskId: string, n: number) => `${taskId}_${n}`;

/** Queue the task; if the queue is unreachable the task is marked FAILED (never left looking queued) and 503 returned. */
async function enqueue(taskId: string, execution: number) {
  try {
    await enqueueAgentTask(taskId, jobIdFor(taskId, execution));
  } catch (err) {
    await db().agentTask.updateMany({
      where: { id: taskId, status: "QUEUED" },
      data: { status: "FAILED", errorCode: "queue_unavailable", errorMessage: "The task queue is unavailable; retry shortly", completedAt: new Date() },
    });
    throw err;
  }
}

/**
 * Create and queue a task. `opts.parentTaskId` (internal: delegation) links it to the delegating task. With an AI
 * employee, the employee must be active and within its monthly token budget.
 */
export async function createTask(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  raw: z.input<typeof createTaskInput>,
  opts: {
    parentTaskId?: string;
    /** Who started the work (inferred from the context when omitted; see autopilot/gate.ts). */
    trigger?: WorkTrigger;
    /** Park the run while its approval requests are decided, then resume with the outcomes (B27). */
    parkOnApproval?: boolean;
  } = {},
) {
  const input = createTaskInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.run");
  requireProvider();
  const trigger = inferTrigger(ctx, opts);
  const department = await departmentForTask(organizationId, companyId, input);
  // "Pause all AI" (/autonomy): no new AI work starts in this company until a person resumes it.
  if (await isCompanyAiPaused(organizationId, companyId)) {
    if (isProactive(trigger)) await logAutopilotRun({ organizationId, companyId }, { department, trigger, mode: "OFF", status: "BLOCKED", reason: "autopilot_paused", title: input.title });
    throw new AppError("not_available", "All AI in this company is paused; resume it in Autonomy", { reason: "workforce_ai_paused" });
  }
  // Company Autopilot: the department's mode, schedule window and the kind of trigger decide whether work may start.
  const gate = await autopilotGate({ organizationId, companyId }, department, trigger);
  if (!gate.allowed) {
    if (isProactive(trigger)) await logAutopilotRun({ organizationId, companyId }, { department, trigger, mode: gate.mode, status: "BLOCKED", reason: gate.reason, title: input.title });
    throw new AppError("not_available", gate.message, { reason: gate.reason });
  }
  await requireBudget(organizationId, companyId, input.profile);
  // Cost budgets (company / department / AI employee): hard stop before any spend.
  await assertSpendAllowed({ organizationId, companyId, department, aiEmployeeId: input.aiEmployeeId ?? null });
  // Plan AI credits (docs/entitlements.md): metered per run in processAgentTask.
  await assertLimit(ctx, organizationId, "ai.credits.month", 1);
  const task = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (input.milestoneId && !(await tx.milestone.findFirst({ where: { id: input.milestoneId, organizationId, companyId }, select: { id: true } }))) {
      throw notFound("Milestone");
    }
    if (input.leadId && !(await tx.lead.findFirst({ where: { id: input.leadId, organizationId, companyId }, select: { id: true } }))) {
      throw notFound("Lead");
    }
    let profile = input.profile;
    if (input.aiEmployeeId) {
      const employee = await tx.aiEmployee.findFirst({
        where: { id: input.aiEmployeeId, organizationId, companyId, archivedAt: null },
        select: { id: true, name: true, status: true, profileKey: true, department: true, model: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true },
      });
      if (!employee) throw notFound("AI employee");
      if (employee.status === "PAUSED") throw conflict(`${employee.name} is paused`, { reason: "workforce_employee_paused" });
      // The employee's own and its department's monthly allowances (tokens and estimated cost).
      await assertEmployeeBudget(organizationId, companyId, employee);
      profile = employee.profileKey as typeof profile;
    }
    if (!profile || !(await resolveProfile({ organizationId, companyId }, profile, tx))) throw notFound("Profile");
    await assertProfileAllowed(profile);
    let depth = 0;
    if (opts.parentTaskId) {
      const parent = await tx.agentTask.findFirst({ where: { id: opts.parentTaskId, organizationId, companyId }, select: { depth: true } });
      if (!parent) throw notFound("Task");
      depth = parent.depth + 1;
      if (depth > MAX_DELEGATION_DEPTH) throw conflict("Delegation is limited to two levels", { reason: "workforce_delegation_too_deep" });
    }
    const t = await tx.agentTask.create({
      data: {
        organizationId,
        companyId,
        profile,
        title: input.title,
        instructions: input.instructions,
        milestoneId: input.milestoneId ?? null,
        leadId: input.leadId ?? null,
        subjectType: input.subject?.type ?? null,
        subjectId: input.subject?.id ?? null,
        aiEmployeeId: input.aiEmployeeId ?? null,
        parentTaskId: opts.parentTaskId ?? null,
        depth,
        ...(opts.parkOnApproval ? { resumeState: { parkOnApproval: true, parks: 0 } satisfies ResumeState } : {}),
        createdById: ctx.actor.id ?? organizationId,
      },
      select: summaryFields,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "agent.task.created",
      resourceType: "agent_task",
      resourceId: t.id,
      newValue: { profile: t.profile, title: t.title, companyId, aiEmployeeId: t.aiEmployeeId, parentTaskId: t.parentTaskId },
    });
    return t;
  });
  if (isProactive(trigger)) await logAutopilotRun({ organizationId, companyId }, { department, trigger, mode: gate.mode, status: "STARTED", title: input.title, taskId: task.id });
  await enqueue(task.id, 1);
  return task;
}

/** The department a new task works for: its AI employee's, else its role's. */
async function departmentForTask(organizationId: string, companyId: string, input: { aiEmployeeId?: string; profile?: string }): Promise<string> {
  if (input.aiEmployeeId) {
    const e = await db().aiEmployee.findFirst({ where: { id: input.aiEmployeeId, organizationId, companyId }, select: { department: true } });
    if (e) return e.department;
  }
  return (input.profile ? (await resolveProfile({ organizationId, companyId }, input.profile))?.department : null) ?? "operations";
}

export async function listTasks(ctx: RequestContext, organizationId: string, companyId: string, rawPage: Partial<PageInput> & Record<string, unknown> = {}) {
  const page = pageInput.parse(rawPage);
  const f = taskFilters.parse(rawPage);
  await authorize(ctx, organizationId, companyId, "agents.read");
  const rows = await db().agentTask.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.aiEmployeeId ? { aiEmployeeId: f.aiEmployeeId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.profile ? { profile: f.profile } : {}),
      ...(f.subjectType ? { subjectType: f.subjectType } : {}),
      ...(f.parentTaskId ? { parentTaskId: f.parentTaskId } : {}),
      ...(f.q ? { title: { contains: f.q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { id: "desc" },
    select: summaryFields,
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

/** Tasks a task delegated (direct children), oldest first. */
export async function listChildTasks(ctx: RequestContext, organizationId: string, companyId: string, parentTaskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().agentTask.findMany({ where: { organizationId, companyId, parentTaskId }, orderBy: { createdAt: "asc" }, select: summaryFields });
}

/** AI tasks attached to one module record (newest first). */
export async function listSubjectTasks(ctx: RequestContext, organizationId: string, companyId: string, subjectType: string, subjectId: string, take = 10) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().agentTask.findMany({ where: { organizationId, companyId, subjectType, subjectId }, orderBy: { createdAt: "desc" }, take, select: { ...summaryFields, output: true } });
}

export async function getTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(taskId)) throw notFound("Task");
  const task = await db().agentTask.findFirst({
    where: { id: taskId, organizationId, companyId },
    omit: { runToken: true, organizationId: true, resumeState: true },
  });
  if (!task) throw notFound("Task");
  return task;
}

export async function cancelTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (!isUuid(taskId)) throw notFound("Task");
    const task = await tx.agentTask.findFirst({ where: { id: taskId, organizationId, companyId }, select: { id: true, status: true } });
    if (!task) throw notFound("Task");
    // A running execution notices the cancellation before its next model call and never overwrites it.
    const { count } = await tx.agentTask.updateMany({ where: { id: taskId, status: { in: [...ACTIVE] } }, data: { status: "CANCELLED", completedAt: new Date(), runToken: null } });
    if (!count) throw conflict("Only queued or running tasks can be cancelled", { reason: "task_not_active" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.cancelled", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status } });
    return { ok: true };
  });
}

/** Re-run a FAILED or CANCELLED task as a new execution (new job id); the previous result is cleared. */
export async function retryTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.run");
  requireProvider();
  await requireBudget(organizationId, companyId);
  const attempts = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (!isUuid(taskId)) throw notFound("Task");
    const task = await tx.agentTask.findFirst({ where: { id: taskId, organizationId, companyId }, select: { status: true, attempts: true, resumeState: true } });
    if (!task) throw notFound("Task");
    const { count } = await tx.agentTask.updateMany({
      where: { id: taskId, status: { in: ["FAILED", "CANCELLED"] } },
      data: { status: "QUEUED", runToken: null, output: null, citations: [], toolCalls: [], errorCode: null, errorMessage: null, startedAt: null, completedAt: null, ...(resumeStateOf(task.resumeState).parkOnApproval ? { resumeState: { parkOnApproval: true, parks: 0 } satisfies ResumeState } : {}) },
    });
    if (!count) throw conflict("Only failed or cancelled tasks can be retried", { reason: "task_not_retryable" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.retried", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status } });
    return task.attempts;
  });
  await enqueue(taskId, attempts + 1);
  return getTask(ctx, organizationId, companyId, taskId);
}

/**
 * Worker entrypoint for one job. The claim (QUEUED → RUNNING with this job's token, or a re-delivery of the same job)
 * guarantees one execution per job; results are written only while the claim still holds, so a cancellation or a
 * newer execution is never overwritten. Retryable failures are rethrown for the queue to retry unless this is the
 * final attempt.
 */
export async function processAgentTask(taskId: string, jobId: string, opts: { finalAttempt: boolean }): Promise<"completed" | "failed" | "skipped" | "parked"> {
  const claimed = await db().agentTask.updateMany({
    where: { id: taskId, OR: [{ status: "QUEUED" }, { status: "RUNNING", runToken: jobId }] },
    data: { status: "RUNNING", runToken: jobId, attempts: { increment: 1 }, startedAt: new Date() },
  });
  if (!claimed.count) return "skipped";
  const held = { id: taskId, status: "RUNNING" as const, runToken: jobId };

  const task = await db().agentTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      company: true,
      aiEmployee: { include: { memories: { orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: MEMORY_IN_PROMPT, select: { content: true } } } },
    },
  });
  const requester = userContext(task.createdById, { requestId: `task_${taskId}` });
  const employee = task.aiEmployee;
  // An AI employee may act as a configured member; tools then run with that member's permissions.
  const ctx = employee?.runsAsUserId ? userContext(employee.runsAsUserId, { requestId: `task_${taskId}` }) : requester;
  const log = logger.child({ component: "agent-task", taskId, jobId });
  const eventData = { profile: task.profile, title: task.title, aiEmployeeId: task.aiEmployeeId, parentTaskId: task.parentTaskId, subjectType: task.subjectType, subjectId: task.subjectId };

  try {
    // Platform AI controls may have changed since the task was queued (kill switch, disabled role/model, budgets).
    const refusal = await aiRefusal(task.organizationId, { profile: task.profile, model: await resolvePlatformModel({ organizationId: task.organizationId, profile: task.profile }) });
    if (refusal) throw new TaskError(refusal, aiRefusalMessage(refusal));
    const platformBudget = await platformBudgetRefusal();
    if (platformBudget) throw new TaskError(platformBudget, "The platform's monthly AI budget is used up; retry later");
    if (await isOrganizationSuspended(task.organizationId)) throw new TaskError("organization_suspended", "This organization is suspended by the platform");
    if (await isCompanyAiPaused(task.organizationId, task.companyId)) throw new TaskError("company_ai_paused", "All AI in this company is paused; resume it in Autonomy and retry");
    // The requester must still be allowed to run tasks in this company when the task executes.
    await authorize(requester, task.organizationId, task.companyId, "agents.run");
    if ((await aiUsageToday(task.organizationId, task.companyId)).exhausted) {
      throw new TaskError("budget_exhausted", "Today's AI allowance for this company is used up; retry tomorrow");
    }
    const profile = await resolveProfile({ organizationId: task.organizationId, companyId: task.companyId }, task.profile);
    if (!profile) throw new TaskError("unknown_profile", "This AI employee profile no longer exists");
    // Park-on-approval (B27): the opt-in, how often it parked, and the parked conversation to resume.
    const resume = resumeStateOf(task.resumeState);
    const park = resume.parkOnApproval
      ? { parks: resume.parks ?? 0, maxParks: MAX_PARKS, resume: resume.parked ?? null, outcomes: resume.parked ? await approvalOutcomes(task.organizationId, task.companyId, resume.parked.waitingFor) : null }
      : null;
    const department = employee?.department ?? profile.department ?? "operations";
    // Company Autopilot may have changed since the task was queued (Off, or Manual for proactively started work).
    const trigger = (await proactiveTriggerOf(taskId)) ?? { kind: "person" as const, source: "person" };
    const gate = await autopilotGate({ organizationId: task.organizationId, companyId: task.companyId }, department, trigger);
    if (!gate.allowed) throw new TaskError(gate.reason, gate.message);
    // Cost budgets (task / AI employee / department / company) may have been reached since the task was queued.
    const spend = await checkSpend({ organizationId: task.organizationId, companyId: task.companyId, department, aiEmployeeId: employee?.id ?? null, taskId });
    if (!spend.ok) throw new TaskError("cost_budget_reached", `${spend.message}; the task did not start. Raise the budget in Costs or retry next period.`);
    let tools: readonly string[] = profile.tools;
    let tokenCeiling: number | null = null;
    if (employee) {
      if (employee.archivedAt) throw new TaskError("employee_archived", "This AI employee was removed");
      if (employee.status === "PAUSED") throw new TaskError("employee_paused", `${employee.name} is paused; resume and retry`);
      // Budgets may have been spent since the task was queued; the remainder caps this run (runtime stops at it).
      const budget = await employeeBudget(task.organizationId, task.companyId, employee);
      const refusal = budgetRefusal(employee.name, budget);
      if (refusal) throw new TaskError(refusal.code, refusal.message);
      tokenCeiling = budget.remainingTokens;
      const allowed = employee.allowedTools.length ? profile.tools.filter((t) => employee.allowedTools.includes(t)) : profile.tools;
      await loadTools();
      tools = toolsForAutonomy(allowed, employee.autonomy);
      if (ctx !== requester) {
        // Never more than the requester could do: offer only tools whose permissions the requester also holds.
        const chain = await companyChain(db(), task.organizationId, task.companyId);
        const keep: string[] = [];
        for (const name of tools) {
          const def = getTool(name);
          if (def && (await Promise.all(def.permissions.map((p) => can(requester, p, chain)))).every(Boolean)) keep.push(name);
        }
        tools = keep;
      }
    }
    const result = await runTask({
      ctx,
      organizationId: task.organizationId,
      companyId: task.companyId,
      company: task.company,
      profile,
      title: task.title,
      instructions: task.instructions,
      taskId: task.id,
      isCancelled: async () => !(await db().agentTask.count({ where: held })),
      tools,
      tokenCeiling,
      runId: jobId,
      park,
      autonomy: { department, aiEmployeeId: employee?.id ?? null },
      employee: employee
        ? {
            name: employee.name,
            instructions: [employee.instructions, employee.personality && `Personality: ${employee.personality}`, employee.communicationStyle && `Communication style: ${employee.communicationStyle}`].filter(Boolean).join("\n\n") || null,
            skills: employee.skills,
            autonomyGuidance: AUTONOMY_GUIDANCE[employee.autonomy],
            memory: employee.memories.map((m) => m.content),
          }
        : null,
    });
    const remembered = employee ? [...result.output.matchAll(REMEMBER_LINE)].map((m) => m[1]!.trim().slice(0, 1000)).filter(Boolean).slice(0, 3) : [];
    const output = employee ? result.output.replace(REMEMBER_LINE, "").trim() || result.output : result.output;
    const stored = await transaction(async (tx) => {
      const { count } = await tx.agentTask.updateMany({
        where: held,
        data: {
          status: "COMPLETED",
          output,
          citations: result.citations as unknown as Prisma.InputJsonValue,
          toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          completedAt: new Date(),
          runToken: null,
          ...(resume.parkOnApproval ? { resumeState: { parkOnApproval: true, parks: resume.parks ?? 0, parked: null } as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      if (count) {
        await recordUsage(task.organizationId, "ai.credits", creditsForTokens(result.inputTokens + result.outputTokens), { companyId: task.companyId, idempotencyKey: taskId, client: tx });
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: task.organizationId, action: "agent.task.completed", resourceType: "agent_task", resourceId: taskId, newValue: { model: result.model, citations: result.citations.length, companyId: task.companyId, tier: result.tier ?? null, costMicros: result.costMicros ?? 0, reusedFromTaskId: result.reusedFromTaskId ?? null } });
        if (employee && remembered.length) {
          await tx.aiEmployeeMemory.createMany({
            data: remembered.map((content) => ({ organizationId: task.organizationId, companyId: task.companyId, aiEmployeeId: employee.id, content, source: "TASK" as const, sourceTaskId: taskId })),
          });
        }
        await emitDomainEvent(tx, ctx, "agent.task.completed", {
          organizationId: task.organizationId,
          companyId: task.companyId,
          entityType: "agent_task",
          entityId: taskId,
          data: { ...eventData, status: "COMPLETED", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        });
      }
      return count > 0;
    });
    // Not stored when the task was cancelled (or re-queued) while the model was working.
    log.info({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, stored }, "agent task finished");
    return stored ? "completed" : "skipped";
  } catch (err) {
    if (err instanceof ParkRun) return parkTask(ctx, task, held, err.state, log);
    const failure =
      err instanceof TaskError
        ? err
        : isAppError(err) && (err.code === "forbidden" || err.code === "not_found")
          ? new TaskError("permission_denied", "The requester can no longer run tasks in this company")
          : new TaskError("internal_error", "Execution failed unexpectedly", true);
    if (failure.code === "cancelled") return "skipped";
    if (failure.retryable && !opts.finalAttempt) {
      log.warn({ code: failure.code, err: err instanceof Error ? err.message : String(err) }, "agent task attempt failed; will retry");
      throw err;
    }
    log.error({ code: failure.code, err: err instanceof Error ? err.message : String(err) }, "agent task failed");
    await transaction(async (tx) => {
      // Tokens a failed run already spent are recorded too, so budgets and cost reports never hide them.
      const spent = failure.usage ? { model: failure.usage.model, inputTokens: failure.usage.inputTokens, outputTokens: failure.usage.outputTokens } : {};
      const { count } = await tx.agentTask.updateMany({ where: held, data: { status: "FAILED", errorCode: failure.code, errorMessage: failure.message, completedAt: new Date(), runToken: null, ...spent } });
      if (count) {
        await emitDomainEvent(tx, ctx, "agent.task.failed", {
          organizationId: task.organizationId,
          companyId: task.companyId,
          entityType: "agent_task",
          entityId: taskId,
          data: { ...eventData, status: "FAILED", errorCode: failure.code },
        });
      }
    });
    if (failure.usage) {
      await recordUsage(task.organizationId, "ai.credits", creditsForTokens(failure.usage.inputTokens + failure.usage.outputTokens), { companyId: task.companyId, idempotencyKey: `${taskId}:failed` }).catch((e) => log.warn({ err: e instanceof Error ? e.message : String(e) }, "AI credit usage not recorded"));
    }
    return "failed";
  }
}

/**
 * Fail tasks whose execution was lost (worker or Redis loss): RUNNING past the time limit, or QUEUED and never picked
 * up. They become retryable instead of looking busy forever.
 */
export async function failStaleTasks(runningMs = 30 * 60_000, queuedMs = 6 * 60 * 60_000): Promise<number> {
  const now = Date.now();
  const [running, queued] = await Promise.all([
    db().agentTask.updateMany({
      where: { status: "RUNNING", startedAt: { lt: new Date(now - runningMs) } },
      data: { status: "FAILED", errorCode: "interrupted", errorMessage: "Execution was interrupted; retry the task", completedAt: new Date(), runToken: null },
    }),
    db().agentTask.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: new Date(now - queuedMs) } },
      data: { status: "FAILED", errorCode: "not_started", errorMessage: "The task was never picked up; check that the worker is running, then retry", completedAt: new Date() },
    }),
  ]);
  return running.count + queued.count;
}

// ───────────── Park-on-approval (G1, B27) ─────────────

/** The decided outcome of each approval a parked run waits for, as lines for the model (data, not instructions). */
export async function approvalOutcomes(organizationId: string, companyId: string, approvalIds: string[]): Promise<string> {
  if (!approvalIds.length) return "";
  const rows = await db().approval.findMany({ where: { organizationId, companyId, id: { in: approvalIds } }, select: { id: true, tool: true, summary: true, status: true, result: true, error: true, decisionNote: true } });
  return rows
    .map((a) => {
      const result = a.result && typeof a.result === "object" && "content" in (a.result as object) ? String((a.result as { content?: unknown }).content ?? "") : "";
      const detail =
        a.status === "EXECUTED" ? `done. Result: ${result.slice(0, 1500)}` : a.status === "FAILED" ? `approved but the action failed: ${a.error ?? "unknown error"}` : a.status === "REJECTED" ? `rejected by a person${a.decisionNote ? ` (note: ${a.decisionNote.slice(0, 300)})` : ""}` : a.status === "EXPIRED" ? "expired without a decision" : `still ${a.status.toLowerCase()}`;
      return `- ${a.tool} — ${a.summary.slice(0, 300)}: ${detail}`;
    })
    .join("\n");
}

/** Store a parked run: WAITING_APPROVAL with its conversation, until approvals/jobs.ts resumes it. */
async function parkTask(ctx: RequestContext, task: { id: string; organizationId: string; companyId: string; resumeState: unknown }, held: { id: string; status: "RUNNING"; runToken: string }, state: ParkedRun, log: { info: (o: object, m: string) => void }): Promise<"parked"> {
  const prev = resumeStateOf(task.resumeState);
  const next: ResumeState = { parkOnApproval: true, parks: (prev.parks ?? 0) + 1, parked: state };
  await transaction(async (tx) => {
    const { count } = await tx.agentTask.updateMany({
      where: held,
      data: { status: "WAITING_APPROVAL", runToken: null, resumeState: next as unknown as Prisma.InputJsonValue, toolCalls: state.toolCalls as unknown as Prisma.InputJsonValue, inputTokens: state.inputTokens, outputTokens: state.outputTokens, model: state.model },
    });
    if (count) await writeAudit(tx, ctx, { category: "TENANT", organizationId: task.organizationId, action: "agent.task.parked", resourceType: "agent_task", resourceId: task.id, newValue: { waitingFor: state.waitingFor, parks: next.parks } });
  });
  log.info({ waitingFor: state.waitingFor, parks: next.parks }, "agent task parked for approval");
  return "parked";
}

const DECIDED = ["EXECUTED", "FAILED", "REJECTED", "EXPIRED"] as const;

/**
 * Resume one parked task once every approval it waits for is decided (idempotent: the WAITING_APPROVAL → QUEUED
 * claim happens once). Kill switch, budgets and the requester's permission are re-checked by processAgentTask.
 */
export async function resumeParkedTask(taskId: string): Promise<boolean> {
  const task = await db().agentTask.findUnique({ where: { id: taskId }, select: { id: true, status: true, attempts: true, organizationId: true, companyId: true, resumeState: true } });
  if (!task || task.status !== "WAITING_APPROVAL") return false;
  const waitingFor = resumeStateOf(task.resumeState).parked?.waitingFor ?? [];
  const open = waitingFor.length ? await db().approval.count({ where: { id: { in: waitingFor }, companyId: task.companyId, status: { notIn: [...DECIDED] } } }) : 0;
  if (open > 0) return false;
  const { count } = await db().agentTask.updateMany({ where: { id: task.id, status: "WAITING_APPROVAL" }, data: { status: "QUEUED" } });
  if (!count) return false;
  await enqueue(task.id, task.attempts + 1);
  return true;
}

/**
 * Worker maintenance: resume parked tasks whose approvals were all decided (covers expiry, which emits no event, and
 * lost events) and fail tasks parked longer than PARK_TIMEOUT_MS. Returns how many changed.
 */
export async function sweepParkedTasks(now = Date.now()): Promise<number> {
  const parked = await db().agentTask.findMany({ where: { status: "WAITING_APPROVAL" }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 200 });
  let changed = 0;
  for (const t of parked) {
    if (await resumeParkedTask(t.id).catch(() => false)) {
      changed++;
      continue;
    }
    if (now - t.updatedAt.getTime() > PARK_TIMEOUT_MS) {
      const r = await db().agentTask.updateMany({ where: { id: t.id, status: "WAITING_APPROVAL" }, data: { status: "FAILED", errorCode: "approval_timeout", errorMessage: "The approvals this task waited for were not decided in time; retry the task", completedAt: new Date() } });
      changed += r.count;
    }
  }
  return changed;
}
