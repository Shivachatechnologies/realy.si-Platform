import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { isModuleEnabled, type PlatformModule } from "@/server/core/platform-controls";
import { createTask } from "@/server/modules/agents/service";

/**
 * "Run by its AI manager": scheduled department work (monthly finance memo, weekly project reports, first support
 * replies) is only queued when the company has hired an active AI employee for that department whose role fits the work.
 * The task runs as that employee, with the permissions of the member it acts for (runsAsUserId, else the member it reports
 * to). Writes still go through supervised tools, so a person approves them; nothing is queued without such an employee.
 */
export interface DepartmentManager {
  employeeId: string;
  name: string;
  organizationId: string;
  companyId: string;
  profileKey: string;
  userId: string;
  autonomy: string;
}

const selectManager = { id: true, name: true, organizationId: true, companyId: true, profileKey: true, runsAsUserId: true, managerUserId: true, autonomy: true } as const;

function toManager(e: { id: string; name: string; organizationId: string; companyId: string; profileKey: string; runsAsUserId: string | null; managerUserId: string | null; autonomy: string }): DepartmentManager | null {
  const userId = e.runsAsUserId ?? e.managerUserId;
  return userId ? { employeeId: e.id, name: e.name, organizationId: e.organizationId, companyId: e.companyId, profileKey: e.profileKey, userId, autonomy: e.autonomy } : null;
}

/** One manager per company (most senior, then longest-serving) among active AI employees with one of `profileKeys`. */
export async function departmentManagers(profileKeys: readonly string[], opts: { companyId?: string } = {}): Promise<DepartmentManager[]> {
  const rows = await db().aiEmployee.findMany({
    where: { status: "ACTIVE", archivedAt: null, profileKey: { in: [...profileKeys] }, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    orderBy: [{ level: "asc" }, { createdAt: "asc" }],
    select: selectManager,
    take: 2000,
  });
  const seen = new Set<string>();
  const out: DepartmentManager[] = [];
  for (const r of rows) {
    if (seen.has(r.companyId)) continue;
    const m = toManager(r);
    if (!m) continue;
    seen.add(r.companyId);
    out.push(m);
  }
  return out;
}

export async function departmentManager(companyId: string, profileKeys: readonly string[]) {
  return (await departmentManagers(profileKeys, { companyId }))[0] ?? null;
}

/**
 * Queue a task for the department's AI manager. With `since`, nothing is queued when a task about the same subject was
 * already created since then (idempotent schedules). Returns the task id, or null when skipped or refused (module off,
 * AI not configured, budget exhausted, the member lost access — logged, never thrown).
 */
export async function runManagerTask(
  m: DepartmentManager,
  module: PlatformModule,
  task: { title: string; instructions: string; subject: { type: string; id: string }; since?: Date },
): Promise<string | null> {
  try {
    if (!(await isModuleEnabled(m.organizationId, module))) return null;
    if (task.since) {
      const existing = await db().agentTask.findFirst({
        where: { organizationId: m.organizationId, companyId: m.companyId, subjectType: task.subject.type, subjectId: task.subject.id, createdAt: { gte: task.since } },
        select: { id: true },
      });
      if (existing) return null;
    }
    const ctx = userContext(m.userId, { requestId: `dept_${task.subject.type}_${task.subject.id.slice(0, 8)}_${Date.now()}` });
    const t = await createTask(ctx, m.organizationId, m.companyId, { aiEmployeeId: m.employeeId, title: task.title.slice(0, 200), instructions: task.instructions.slice(0, 8000), subject: task.subject });
    return t.id;
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : err, companyId: m.companyId, subject: task.subject.type }, "department manager task not queued");
    return null;
  }
}
