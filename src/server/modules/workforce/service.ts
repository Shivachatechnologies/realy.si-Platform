import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { AGENT_PROFILES, profileByKey } from "@/server/modules/agents/profiles";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AUTONOMY_LEVELS } from "./autonomy";
import { tokenUsage, utcMonthStart } from "./usage";

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
};
export const createEmployeeInput = z.object({ profileKey: z.string().regex(/^[a-z_]{2,60}$/), ...employeeFields });
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiEmployeeSelect;

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
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    await checkRunsAs(tx, organizationId, input.runsAsUserId);
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
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.aiEmployee.findFirst({ where: { id: employeeId, organizationId, companyId, archivedAt: null }, select: employeeSelect });
    if (!before) throw notFound("AI employee");
    checkTools(before.profileKey, input.allowedTools);
    await checkRunsAs(tx, organizationId, input.runsAsUserId);
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
      },
      select: employeeSelect,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "ai_employee.updated",
      resourceType: "ai_employee",
      resourceId: e.id,
      oldValue: { autonomy: before.autonomy, runsAsUserId: before.runsAsUserId, monthlyTokenBudget: before.monthlyTokenBudget, allowedTools: before.allowedTools },
      newValue: { companyId, name: e.name, autonomy: e.autonomy, runsAsUserId: e.runsAsUserId, monthlyTokenBudget: e.monthlyTokenBudget, allowedTools: e.allowedTools },
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
  for (const m of STARTER_TEAM) {
    if (existing.has(m.profileKey) || !profileByKey(m.profileKey)) continue;
    const e = await createEmployee(ctx, organizationId, companyId, { profileKey: m.profileKey, name: m.name });
    created.push(e.id);
  }
  return { created: created.length, skipped: STARTER_TEAM.length - created.length };
}
