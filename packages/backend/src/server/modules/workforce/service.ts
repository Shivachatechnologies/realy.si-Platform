import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { AGENT_PROFILES, profileByKey } from "@/server/modules/agents/profiles";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AUTONOMY_LEVELS } from "./autonomy";
import { cancelTask, createTask, getTask } from "@/server/modules/agents/service";
import { allowedModels } from "./models";
import { costMicros } from "./pricing";
import { tokenUsage, utcMonthStart } from "./usage";
import { assertFeature, assertLimit } from "@/server/modules/entitlements/service";

export const ORG_LEVELS = ["EXECUTIVE", "MANAGER", "SPECIALIST"] as const;
/** Default org level of a role: the AI CEO is an executive, department leads are managers. */
const EXECUTIVE_PROFILES = new Set(["ai_ceo"]);
const MANAGER_PROFILES = new Set(["cmo", "ai_cfo", "sales_manager", "ai_project_manager", "support_lead", "people_analyst"]);
export const defaultLevelFor = (profileKey: string): (typeof ORG_LEVELS)[number] => (EXECUTIVE_PROFILES.has(profileKey) ? "EXECUTIVE" : MANAGER_PROFILES.has(profileKey) ? "MANAGER" : "SPECIALIST");

export const DEPARTMENTS = ["executive", "sales", "marketing", "finance", "hr", "engineering", "product", "support", "operations", "research"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** A profile's department (profiles without one are grouped under operations). */
export const departmentOf = (profileKey: string): Department => {
  const d = profileByKey(profileKey)?.department;
  return (DEPARTMENTS as readonly string[]).includes(d ?? "") ? (d as Department) : "operations";
};

/** Role gallery: every profile grouped by department. */
export function rolesByDepartment() {
  const out = new Map<Department, typeof AGENT_PROFILES>();
  for (const p of AGENT_PROFILES) {
    const d = departmentOf(p.key);
    out.set(d, [...(out.get(d) ?? []), p]);
  }
  return DEPARTMENTS.filter((d) => out.has(d)).map((d) => ({ department: d, profiles: out.get(d)! }));
}

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("") || "AI";

const employeeFields = {
  name: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(1).max(3).optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  allowedTools: z.array(z.string().regex(/^[a-z0-9_]{2,60}$/)).max(60).optional(),
  runsAsUserId: z.string().uuid().nullable().optional(),
  autonomy: z.enum(AUTONOMY_LEVELS).optional(),
  monthlyTokenBudget: z.number().int().min(1000).max(1_000_000_000).nullable().optional(),
  /** Monthly estimated-cost allowance in USD cents. */
  monthlyCostBudgetCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  managerEmployeeId: z.string().uuid().nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  level: z.enum(ORG_LEVELS).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  jobDescription: z.string().trim().max(4000).nullable().optional(),
  responsibilities: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  goals: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  kpis: z.array(z.object({ key: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/).max(100), target: z.number().finite() })).max(20).optional(),
  model: z.string().regex(/^[a-z0-9.-]{3,64}$/).nullable().optional(),
};
export const createEmployeeInput = z.object({
  profileKey: z.string().regex(/^[a-z_]{2,60}$/),
  ...employeeFields,
  /** false = start paused and go through the setup steps (activate at the end). */
  activate: z.boolean().optional(),
});
export const updateEmployeeInput = z.object({ ...employeeFields, name: employeeFields.name.optional() });
export const employeeStatusInput = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });
export const memoryInput = z.object({ content: z.string().trim().min(1).max(1000), pinned: z.boolean().optional() });
export const memoryUpdateInput = z.object({ pinned: z.boolean() });
export const employeeFilters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["ACTIVE", "PAUSED"]).optional().catch(undefined),
  department: z.enum(DEPARTMENTS).optional().catch(undefined),
});

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

async function checkRunsAs(tx: Tx, organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { status: true } });
  if (m?.status !== "ACTIVE") throw invalid("The runs-as user must be an active member", { reason: "workforce_employee_runs_as_invalid" });
}

function checkModel(model: string | null | undefined) {
  if (model && !allowedModels().includes(model)) throw invalid("This model is not allowed on the platform", { reason: "workforce_employee_model_not_allowed" });
}

/** The manager must be another live employee of the company, and the chain must not loop back to this employee. */
async function checkManager(tx: Tx, organizationId: string, companyId: string, employeeId: string | null, managerEmployeeId: string | null | undefined) {
  if (!managerEmployeeId) return;
  if (managerEmployeeId === employeeId) throw invalid("An AI employee cannot manage itself", { reason: "workforce_manager_cycle" });
  let cursor: string | null = managerEmployeeId;
  for (let i = 0; cursor && i < 50; i++) {
    const m: { id: string; managerEmployeeId: string | null } | null = await tx.aiEmployee.findFirst({ where: { id: cursor, organizationId, companyId, archivedAt: null }, select: { id: true, managerEmployeeId: true } });
    if (!m) throw invalid("The manager must be an AI employee of this company", { reason: "workforce_manager_invalid" });
    if (employeeId && m.managerEmployeeId === employeeId) throw invalid("This would make the reporting line loop", { reason: "workforce_manager_cycle" });
    cursor = m.managerEmployeeId;
  }
}

function checkTools(profileKey: string, tools: string[] | undefined) {
  if (!tools) return;
  const profile = profileByKey(profileKey)!;
  const bad = tools.filter((t) => !profile.tools.includes(t));
  if (bad.length) throw invalid(`Tools not available to this role: ${bad.join(", ")}`, { reason: "workforce_employee_tool_not_in_profile" });
}

const employeeSelect = {
  id: true,
  name: true,
  initials: true,
  profileKey: true,
  department: true,
  instructions: true,
  skills: true,
  allowedTools: true,
  runsAsUserId: true,
  runsAs: { select: { id: true, name: true } },
  status: true,
  autonomy: true,
  monthlyTokenBudget: true,
  monthlyCostBudgetCents: true,
  managerEmployeeId: true,
  managerUserId: true,
  manager: { select: { id: true, name: true, initials: true } },
  level: true,
  jobTitle: true,
  jobDescription: true,
  responsibilities: true,
  goals: true,
  kpis: true,
  model: true,
  setupCompletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiEmployeeSelect;

export interface EmployeeKpi {
  key: string;
  target: number;
}
export const kpisOf = (raw: unknown): EmployeeKpi[] =>
  Array.isArray(raw) ? raw.flatMap((k) => (k && typeof k === "object" && typeof (k as EmployeeKpi).key === "string" && typeof (k as EmployeeKpi).target === "number" ? [k as EmployeeKpi] : [])) : [];

export async function listEmployees(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  const f = employeeFilters.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().aiEmployee.findMany({
    where: {
      organizationId,
      companyId,
      archivedAt: null,
      ...(f.status ? { status: f.status } : {}),
      ...(f.department ? { department: f.department } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { skills: { has: f.q } }, { profileKey: { contains: f.q.toLowerCase().replace(/\s+/g, "_") } }] } : {}),
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: employeeSelect,
  });
}

export async function getEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findFirst({ where: { id: employeeId, organizationId, companyId, archivedAt: null }, select: employeeSelect });
  if (!e) throw notFound("AI employee");
  return e;
}

export async function createEmployee(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createEmployeeInput>) {
  const input = createEmployeeInput.parse(raw);
  const profile = profileByKey(input.profileKey);
  if (!profile) throw notFound("Profile");
  checkTools(profile.key, input.allowedTools);
  // Plan entitlements (docs/entitlements.md): AI employee count, Auto autonomy, executive / manager roles.
  await assertLimit(ctx, organizationId, "agents.max", 1);
  if (input.autonomy === "AUTONOMOUS_LOW_RISK") await assertFeature(ctx, organizationId, "feature.autonomy_auto");
  if ((input.level ?? defaultLevelFor(profile.key)) !== "SPECIALIST") await assertFeature(ctx, organizationId, "feature.executive_team");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    await checkRunsAs(tx, organizationId, input.runsAsUserId);
    await checkRunsAs(tx, organizationId, input.managerUserId);
    await checkManager(tx, organizationId, companyId, null, input.managerEmployeeId);
    checkModel(input.model);
    const e = await tx.aiEmployee.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        initials: (input.initials ?? initialsOf(input.name)).toUpperCase(),
        profileKey: profile.key,
        department: departmentOf(profile.key),
        instructions: input.instructions ?? null,
        skills: [...new Set(input.skills ?? [])],
        allowedTools: [...new Set(input.allowedTools ?? [])],
        runsAsUserId: input.runsAsUserId ?? null,
        autonomy: input.autonomy ?? "EXECUTE_WITH_APPROVAL",
        monthlyTokenBudget: input.monthlyTokenBudget ?? null,
        monthlyCostBudgetCents: input.monthlyCostBudgetCents == null ? null : BigInt(input.monthlyCostBudgetCents),
        managerEmployeeId: input.managerEmployeeId ?? null,
        // Without an AI manager the employee reports to a person: the given one, else whoever hires it.
        managerUserId: input.managerEmployeeId ? null : (input.managerUserId ?? (ctx.actor.type === "USER" ? ctx.actor.id : null) ?? null),
        level: input.level ?? defaultLevelFor(profile.key),
        jobTitle: input.jobTitle ?? null,
        jobDescription: input.jobDescription ?? null,
        responsibilities: input.responsibilities ?? [],
        goals: input.goals ?? [],
        kpis: input.kpis ?? [],
        model: input.model ?? null,
        status: input.activate === false ? "PAUSED" : "ACTIVE",
        setupCompletedAt: input.activate === false ? null : new Date(),
        createdById: ctx.actor.id ?? organizationId,
      },
      select: employeeSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_employee.created", resourceType: "ai_employee", resourceId: e.id, newValue: { companyId, name: e.name, profile: e.profileKey } });
    return e;
  });
}

export async function updateEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof updateEmployeeInput>) {
  const input = updateEmployeeInput.parse(raw);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  if (input.autonomy === "AUTONOMOUS_LOW_RISK") await assertFeature(ctx, organizationId, "feature.autonomy_auto");
  if (input.level !== undefined && input.level !== "SPECIALIST") await assertFeature(ctx, organizationId, "feature.executive_team");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.aiEmployee.findFirst({ where: { id: employeeId, organizationId, companyId, archivedAt: null }, select: employeeSelect });
    if (!before) throw notFound("AI employee");
    checkTools(before.profileKey, input.allowedTools);
    await checkRunsAs(tx, organizationId, input.runsAsUserId);
    await checkRunsAs(tx, organizationId, input.managerUserId);
    await checkManager(tx, organizationId, companyId, employeeId, input.managerEmployeeId);
    checkModel(input.model);
    const e = await tx.aiEmployee.update({
      where: { id: employeeId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.initials !== undefined ? { initials: input.initials.toUpperCase() } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
        ...(input.skills !== undefined ? { skills: [...new Set(input.skills)] } : {}),
        ...(input.allowedTools !== undefined ? { allowedTools: [...new Set(input.allowedTools)] } : {}),
        ...(input.runsAsUserId !== undefined ? { runsAsUserId: input.runsAsUserId } : {}),
        ...(input.autonomy !== undefined ? { autonomy: input.autonomy } : {}),
        ...(input.monthlyTokenBudget !== undefined ? { monthlyTokenBudget: input.monthlyTokenBudget } : {}),
        ...(input.monthlyCostBudgetCents !== undefined ? { monthlyCostBudgetCents: input.monthlyCostBudgetCents === null ? null : BigInt(input.monthlyCostBudgetCents) } : {}),
        ...(input.managerEmployeeId !== undefined ? { managerEmployeeId: input.managerEmployeeId, ...(input.managerEmployeeId ? { managerUserId: null } : {}) } : {}),
        ...(input.managerUserId !== undefined ? { managerUserId: input.managerUserId, ...(input.managerUserId ? { managerEmployeeId: null } : {}) } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle || null } : {}),
        ...(input.jobDescription !== undefined ? { jobDescription: input.jobDescription || null } : {}),
        ...(input.responsibilities !== undefined ? { responsibilities: input.responsibilities } : {}),
        ...(input.goals !== undefined ? { goals: input.goals } : {}),
        ...(input.kpis !== undefined ? { kpis: input.kpis } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
      },
      select: employeeSelect,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "ai_employee.updated",
      resourceType: "ai_employee",
      resourceId: e.id,
      oldValue: { autonomy: before.autonomy, runsAsUserId: before.runsAsUserId, monthlyTokenBudget: before.monthlyTokenBudget, monthlyCostBudgetCents: before.monthlyCostBudgetCents === null ? null : Number(before.monthlyCostBudgetCents), allowedTools: before.allowedTools, managerEmployeeId: before.managerEmployeeId, managerUserId: before.managerUserId, level: before.level, model: before.model },
      newValue: { companyId, name: e.name, autonomy: e.autonomy, runsAsUserId: e.runsAsUserId, monthlyTokenBudget: e.monthlyTokenBudget, monthlyCostBudgetCents: e.monthlyCostBudgetCents === null ? null : Number(e.monthlyCostBudgetCents), allowedTools: e.allowedTools, managerEmployeeId: e.managerEmployeeId, managerUserId: e.managerUserId, level: e.level, model: e.model },
    });
    return e;
  });
}

export async function setEmployeeStatus(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof employeeStatusInput>) {
  const { status } = employeeStatusInput.parse(raw);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const { count } = await tx.aiEmployee.updateMany({ where: { id: employeeId, organizationId, companyId, archivedAt: null, status: { not: status } }, data: { status } });
    // Activating completes the lifecycle setup.
    if (count && status === "ACTIVE") await tx.aiEmployee.updateMany({ where: { id: employeeId, setupCompletedAt: null }, data: { setupCompletedAt: new Date() } });
    if (!count) {
      if (!(await tx.aiEmployee.count({ where: { id: employeeId, organizationId, companyId, archivedAt: null } }))) throw notFound("AI employee");
      throw conflict(`Already ${status.toLowerCase()}`, { reason: "workforce_employee_status_unchanged" });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: status === "PAUSED" ? "ai_employee.paused" : "ai_employee.resumed", resourceType: "ai_employee", resourceId: employeeId, newValue: { companyId, status } });
    return { ok: true, status };
  });
}

/** Remove an AI employee (soft: its task history stays). Its schedules are disabled. */
export async function archiveEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  if (!isUuid(employeeId)) throw notFound("AI employee");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const { count } = await tx.aiEmployee.updateMany({ where: { id: employeeId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date(), status: "PAUSED" } });
    if (!count) throw notFound("AI employee");
    await tx.aiSchedule.updateMany({ where: { aiEmployeeId: employeeId, companyId }, data: { enabled: false } });
    // Its reports move up to its own manager (or the person it reported to).
    const gone = await tx.aiEmployee.findUnique({ where: { id: employeeId }, select: { managerEmployeeId: true, managerUserId: true } });
    await tx.aiEmployee.updateMany({ where: { managerEmployeeId: employeeId, companyId }, data: { managerEmployeeId: gone?.managerEmployeeId ?? null, managerUserId: gone?.managerEmployeeId ? null : (gone?.managerUserId ?? null) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_employee.archived", resourceType: "ai_employee", resourceId: employeeId, newValue: { companyId } });
    return { ok: true };
  });
}

// ───────────── Memory ─────────────

export async function listMemories(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, take = 100) {
  await getEmployee(ctx, organizationId, companyId, employeeId);
  return db().aiEmployeeMemory.findMany({ where: { aiEmployeeId: employeeId, companyId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take });
}

export async function addMemory(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof memoryInput>) {
  const input = memoryInput.parse(raw);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    if (!(await tx.aiEmployee.count({ where: { id: employeeId, organizationId, companyId, archivedAt: null } }))) throw notFound("AI employee");
    const m = await tx.aiEmployeeMemory.create({ data: { organizationId, companyId, aiEmployeeId: employeeId, content: input.content, pinned: input.pinned ?? false, source: "MANUAL", createdById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_employee.memory_added", resourceType: "ai_employee", resourceId: employeeId, newValue: { companyId, memoryId: m.id } });
    return m;
  });
}

export async function updateMemory(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, memoryId: string, raw: z.input<typeof memoryUpdateInput>) {
  const input = memoryUpdateInput.parse(raw);
  if (!isUuid(memoryId) || !isUuid(employeeId)) throw notFound("Memory");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const { count } = await tx.aiEmployeeMemory.updateMany({ where: { id: memoryId, aiEmployeeId: employeeId, organizationId, companyId }, data: { pinned: input.pinned } });
    if (!count) throw notFound("Memory");
    return { ok: true };
  });
}

export async function deleteMemory(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, memoryId: string) {
  if (!isUuid(memoryId) || !isUuid(employeeId)) throw notFound("Memory");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const { count } = await tx.aiEmployeeMemory.deleteMany({ where: { id: memoryId, aiEmployeeId: employeeId, organizationId, companyId } });
    if (!count) throw notFound("Memory");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_employee.memory_deleted", resourceType: "ai_employee", resourceId: employeeId, newValue: { companyId, memoryId } });
    return { ok: true };
  });
}

// ───────────── Performance & usage ─────────────

export interface EmployeeStats {
  completed: number;
  failed: number;
  active: number;
  avgDurationMs: number | null;
  approvalsRequested: number;
  approvalsApproved: number;
  monthTokens: number;
  monthCostMicros: number;
}

const emptyStats = (): EmployeeStats => ({ completed: 0, failed: 0, active: 0, avgDurationMs: null, approvalsRequested: 0, approvalsApproved: 0, monthTokens: 0, monthCostMicros: 0 });

/** Performance and this month's usage per employee (caller must have checked agents.read). */
export async function employeeStats(organizationId: string, companyId: string, employeeIds: string[]): Promise<Map<string, EmployeeStats>> {
  const out = new Map(employeeIds.map((id) => [id, emptyStats()]));
  if (!employeeIds.length) return out;
  const scope = { organizationId, companyId, aiEmployeeId: { in: employeeIds } };
  const [byStatus, finished, approvals, usage] = await Promise.all([
    db().agentTask.groupBy({ by: ["aiEmployeeId", "status"], where: scope, _count: { _all: true } }),
    db().agentTask.findMany({ where: { ...scope, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } }, select: { aiEmployeeId: true, startedAt: true, completedAt: true }, orderBy: { id: "desc" }, take: 2000 }),
    db().approval.findMany({ where: { organizationId, companyId, task: { aiEmployeeId: { in: employeeIds } } }, select: { status: true, task: { select: { aiEmployeeId: true } } }, take: 5000 }),
    tokenUsage(scope, utcMonthStart()),
  ]);
  for (const r of byStatus) {
    const s = out.get(r.aiEmployeeId!);
    if (!s) continue;
    if (r.status === "COMPLETED") s.completed = r._count._all;
    else if (r.status === "FAILED") s.failed = r._count._all;
    else if (r.status === "QUEUED" || r.status === "RUNNING") s.active += r._count._all;
  }
  const durations = new Map<string, number[]>();
  for (const t of finished) durations.set(t.aiEmployeeId!, [...(durations.get(t.aiEmployeeId!) ?? []), t.completedAt!.getTime() - t.startedAt!.getTime()]);
  for (const [id, d] of durations) out.get(id)!.avgDurationMs = d.reduce((a, b) => a + b, 0) / d.length;
  for (const a of approvals) {
    const s = out.get(a.task?.aiEmployeeId ?? "");
    if (!s) continue;
    s.approvalsRequested++;
    if (a.status === "APPROVED" || a.status === "EXECUTED") s.approvalsApproved++;
  }
  for (const [id, u] of usage.byEmployee) {
    const s = out.get(id ?? "");
    if (s) {
      s.monthTokens = u.tokens;
      s.monthCostMicros = u.costMicros;
    }
  }
  return out;
}

/** Active members of the organization (for the runs-as picker). */
export async function listMembers(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const rows = await db().membership.findMany({ where: { organizationId, status: "ACTIVE" }, select: { user: { select: { id: true, name: true } } }, take: 500 });
  return rows.map((r) => r.user).sort((a, b) => a.name.localeCompare(b.name));
}

/** The founder's core AI team: one AI employee per key role (profile key → display name). */
export const STARTER_TEAM: { profileKey: string; name: string }[] = [
  { profileKey: "ai_ceo", name: "AI CEO" },
  { profileKey: "sales_manager", name: "AI Sales Manager" },
  { profileKey: "cmo", name: "AI Marketing Manager" },
  { profileKey: "ai_cfo", name: "AI Finance Analyst" },
  { profileKey: "people_analyst", name: "AI HR Manager" },
  { profileKey: "ai_project_manager", name: "AI Project Manager" },
  { profileKey: "support_agent", name: "AI Customer Support" },
  { profileKey: "research_analyst", name: "AI Research Analyst" },
];

/** Hire the starter team in one go; roles the company already staffs (same profile) are skipped. */
export async function hireStarterTeam(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  const existing = new Set((await db().aiEmployee.findMany({ where: { companyId, archivedAt: null }, select: { profileKey: true } })).map((e) => e.profileKey));
  const created: string[] = [];
  // The org chart: the AI CEO reports to the founder, everyone else to the AI CEO.
  let ceoId = (await db().aiEmployee.findFirst({ where: { organizationId, companyId, profileKey: "ai_ceo", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
  for (const m of STARTER_TEAM) {
    if (existing.has(m.profileKey) || !profileByKey(m.profileKey)) continue;
    const e = await createEmployee(ctx, organizationId, companyId, { profileKey: m.profileKey, name: m.name, ...(m.profileKey !== "ai_ceo" && ceoId ? { managerEmployeeId: ceoId } : {}) });
    if (m.profileKey === "ai_ceo") ceoId = e.id;
    created.push(e.id);
  }
  return { created: created.length, skipped: STARTER_TEAM.length - created.length };
}

// ───────────── Org chart, performance history, reports ─────────────

export interface OrgNode {
  id: string;
  name: string;
  initials: string;
  profileKey: string;
  department: string;
  level: (typeof ORG_LEVELS)[number];
  jobTitle: string | null;
  status: "ACTIVE" | "PAUSED";
  reports: OrgNode[];
}

/**
 * The AI workforce as a tree under the founder: employees without an AI manager are roots (executives first), each
 * with its reports nested. Employees whose manager was archived are attached at the root.
 */
export async function orgChart(ctx: RequestContext, organizationId: string, companyId: string) {
  const rows = await listEmployees(ctx, organizationId, companyId);
  const ids = new Set(rows.map((r) => r.id));
  const nodes = new Map<string, OrgNode>(rows.map((r) => [r.id, { id: r.id, name: r.name, initials: r.initials, profileKey: r.profileKey, department: r.department, level: r.level, jobTitle: r.jobTitle, status: r.status, reports: [] }]));
  const roots: OrgNode[] = [];
  for (const r of rows) {
    const n = nodes.get(r.id)!;
    if (r.managerEmployeeId && ids.has(r.managerEmployeeId)) nodes.get(r.managerEmployeeId)!.reports.push(n);
    else roots.push(n);
  }
  const rank = { EXECUTIVE: 0, MANAGER: 1, SPECIALIST: 2 } as const;
  const sort = (list: OrgNode[]) => {
    list.sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
    for (const n of list) sort(n.reports);
  };
  sort(roots);
  const founderIds = [...new Set(rows.filter((r) => !r.managerEmployeeId && r.managerUserId).map((r) => r.managerUserId!))];
  const founders = founderIds.length ? await db().user.findMany({ where: { id: { in: founderIds } }, select: { id: true, name: true } }) : [];
  return { roots, founders, count: rows.length };
}

/** Direct reports of an AI employee (live ones). */
export async function directReports(organizationId: string, companyId: string, employeeId: string) {
  return db().aiEmployee.findMany({ where: { organizationId, companyId, managerEmployeeId: employeeId, archivedAt: null }, select: { id: true, name: true, initials: true, profileKey: true, status: true, level: true, jobTitle: true }, orderBy: { name: "asc" } });
}

export interface WeekPerformance {
  /** Monday (UTC) of the week, YYYY-MM-DD. */
  week: string;
  completed: number;
  failed: number;
  approvalsRequested: number;
  approvalsApproved: number;
  /** approved / requested, null without requests. */
  approvalRate: number | null;
  costMicros: number;
}

const DAY = 86_400_000;
const mondayOf = (d: Date) => {
  const u = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(u - ((new Date(u).getUTCDay() + 6) % 7) * DAY);
};

/** Per-week performance of one employee over the last `weeks` weeks (oldest first). Caller has checked agents.read. */
export async function performanceHistory(organizationId: string, companyId: string, employeeId: string, weeks = 12): Promise<WeekPerformance[]> {
  const start = new Date(mondayOf(new Date()).getTime() - (weeks - 1) * 7 * DAY);
  const [tasks, approvals] = await Promise.all([
    db().agentTask.findMany({
      where: { organizationId, companyId, aiEmployeeId: employeeId, OR: [{ completedAt: { gte: start } }, { startedAt: { gte: start } }] },
      select: { status: true, completedAt: true, startedAt: true, model: true, inputTokens: true, outputTokens: true },
      take: 10_000,
    }),
    db().approval.findMany({ where: { organizationId, companyId, createdAt: { gte: start }, task: { aiEmployeeId: employeeId } }, select: { status: true, createdAt: true }, take: 10_000 }),
  ]);
  const out: WeekPerformance[] = Array.from({ length: weeks }, (_, i) => ({ week: new Date(start.getTime() + i * 7 * DAY).toISOString().slice(0, 10), completed: 0, failed: 0, approvalsRequested: 0, approvalsApproved: 0, approvalRate: null, costMicros: 0 }));
  const idx = (d: Date) => Math.floor((mondayOf(d).getTime() - start.getTime()) / (7 * DAY));
  for (const t of tasks) {
    if (t.completedAt && (t.status === "COMPLETED" || t.status === "FAILED")) {
      const w = out[idx(t.completedAt)];
      if (w && t.status === "COMPLETED") w.completed++;
      else if (w) w.failed++;
    }
    if (t.startedAt) {
      const w = out[idx(t.startedAt)];
      if (w) w.costMicros += costMicros(t.model, t.inputTokens ?? 0, t.outputTokens ?? 0);
    }
  }
  for (const a of approvals) {
    const w = out[idx(a.createdAt)];
    if (!w) continue;
    w.approvalsRequested++;
    if (a.status === "APPROVED" || a.status === "EXECUTED") w.approvalsApproved++;
  }
  for (const w of out) w.approvalRate = w.approvalsRequested ? w.approvalsApproved / w.approvalsRequested : null;
  return out;
}

/** Status reports and escalations filed by an employee or with it (as manager), newest first. */
export async function listReports(ctx: RequestContext, organizationId: string, companyId: string, opts: { authorId?: string; managerId?: string; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().aiEmployeeReport.findMany({
    where: {
      organizationId,
      companyId,
      ...(opts.authorId || opts.managerId ? { OR: [...(opts.authorId ? [{ aiEmployeeId: opts.authorId }] : []), ...(opts.managerId ? [{ managerEmployeeId: opts.managerId }] : [])] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 30,
    include: { aiEmployee: { select: { id: true, name: true, initials: true } }, manager: { select: { id: true, name: true } } },
  });
}

/** Setup checklist of the lifecycle: create → configure → role → goals → permissions → activate. */
export function setupSteps(e: {
  instructions: string | null;
  jobTitle: string | null;
  jobDescription: string | null;
  responsibilities: string[];
  managerEmployeeId: string | null;
  managerUserId: string | null;
  goals: string[];
  kpis: unknown;
  status: string;
  setupCompletedAt: Date | null;
  runsAsUserId: string | null;
  monthlyTokenBudget: number | null;
  monthlyCostBudgetCents?: bigint | null;
  allowedTools: string[];
}) {
  return [
    { key: "create", done: true },
    { key: "configure", done: !!(e.jobTitle || e.jobDescription || e.instructions) },
    { key: "role", done: !!(e.managerEmployeeId || e.managerUserId) && e.responsibilities.length > 0 },
    { key: "goals", done: e.goals.length > 0 || kpisOf(e.kpis).length > 0 },
    { key: "permissions", done: !!e.setupCompletedAt || !!e.runsAsUserId || e.monthlyTokenBudget !== null || (e.monthlyCostBudgetCents ?? null) !== null || e.allowedTools.length > 0 },
    { key: "activate", done: e.status === "ACTIVE" },
  ] as const;
}

export const reassignInput = z.object({ aiEmployeeId: z.string().uuid() });

/**
 * Reassign an AI task to another AI employee: a queued task is cancelled and a failed / cancelled one left as is; a
 * new task with the same title and instructions is created for the new employee (same subject), through the agents
 * service (its permission, budget and status checks apply).
 */
export async function reassignAiTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof reassignInput>) {
  const { aiEmployeeId } = reassignInput.parse(raw);
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.status === "RUNNING" || task.status === "COMPLETED") throw conflict("Only queued, failed or cancelled tasks can be reassigned", { reason: "workforce_task_not_reassignable" });
  if (task.aiEmployeeId === aiEmployeeId) throw conflict("The task is already assigned to this AI employee", { reason: "workforce_task_same_employee" });
  if (task.status === "QUEUED") await cancelTask(ctx, organizationId, companyId, taskId);
  const created = await createTask(ctx, organizationId, companyId, {
    aiEmployeeId,
    title: task.title,
    instructions: task.instructions,
    ...(task.subjectType && task.subjectId ? { subject: { type: task.subjectType, id: task.subjectId } } : {}),
    ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
    ...(task.leadId ? { leadId: task.leadId } : {}),
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.reassigned", resourceType: "agent_task", resourceId: taskId, newValue: { companyId, newTaskId: created.id, aiEmployeeId } }));
  return created;
}

/** Per employee: the task it is working on now (running first, else next queued) and completed tasks per week (oldest first). */
export async function liveActivity(organizationId: string, companyId: string, employeeIds: string[], weeks = 8) {
  const out = new Map<string, { current: { id: string; title: string; status: "RUNNING" | "QUEUED"; startedAt: Date | null } | null; weekly: number[] }>(employeeIds.map((id) => [id, { current: null, weekly: Array(weeks).fill(0) }]));
  if (!employeeIds.length) return out;
  const start = new Date(mondayOf(new Date()).getTime() - (weeks - 1) * 7 * DAY);
  const [active, done] = await Promise.all([
    db().agentTask.findMany({ where: { organizationId, companyId, aiEmployeeId: { in: employeeIds }, status: { in: ["RUNNING", "QUEUED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, startedAt: true, aiEmployeeId: true }, take: 500 }),
    db().agentTask.findMany({ where: { organizationId, companyId, aiEmployeeId: { in: employeeIds }, status: "COMPLETED", completedAt: { gte: start } }, select: { aiEmployeeId: true, completedAt: true }, take: 20_000 }),
  ]);
  for (const t of active) {
    const s = out.get(t.aiEmployeeId!);
    if (s && (!s.current || (s.current.status === "QUEUED" && t.status === "RUNNING"))) s.current = { id: t.id, title: t.title, status: t.status as "RUNNING" | "QUEUED", startedAt: t.startedAt };
  }
  for (const t of done) {
    const s = out.get(t.aiEmployeeId!);
    const i = Math.floor((mondayOf(t.completedAt!).getTime() - start.getTime()) / (7 * DAY));
    if (s && i >= 0 && i < weeks) s.weekly[i]!++;
  }
  return out;
}
