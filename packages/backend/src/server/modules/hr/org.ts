import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid, optText, patchText, requireEmployee, uuid } from "./access";

/** Organization structure: departments (tree), teams, reporting lines (org chart) and the roles overview. */

export const departmentInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: optText(1000),
  parentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  headId: uuid.optional().or(z.literal("").transform(() => undefined)),
  costCenterCode: optText(40),
});
export const departmentPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: patchText(1000),
  parentId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  headId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  costCenterCode: patchText(40),
});
export const teamInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: optText(1000),
  departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  leadId: uuid.optional().or(z.literal("").transform(() => undefined)),
});
export const teamPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: patchText(1000),
  departmentId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  leadId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
});
export const teamMemberInput = z.object({ employeeId: uuid, action: z.enum(["add", "remove"]) });

const nil = (v: string | null | undefined) => (v ? v : null);

async function requireDepartment(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Department");
  const d = await tx.department.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!d) throw notFound("Department");
  return d;
}

/** Refuse a parent that is the department itself or one of its descendants. */
async function assertNoCycle(tx: Tx, companyId: string, id: string, parentId: string) {
  let current: string | null = parentId;
  for (let i = 0; current && i < 100; i++) {
    if (current === id) throw invalid("A department can't be inside itself", { reason: "hr_department_cycle" });
    const row: { parentId: string | null } | null = await tx.department.findFirst({ where: { id: current, companyId }, select: { parentId: true } });
    current = row?.parentId ?? null;
  }
}

const uniqueName = (e: unknown, what: string) => {
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw conflict(`A ${what} with this name already exists`, { reason: "hr_name_taken" });
  throw e;
};

export async function listDepartments(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().department.findMany({ take: 500,
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      head: { select: { id: true, firstName: true, lastName: true, title: true } },
      _count: { select: { employees: { where: { archivedAt: null, status: { not: "TERMINATED" } } }, teams: { where: { archivedAt: null } } } },
    },
  });
}

export async function createDepartment(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof departmentInput>) {
  const input = departmentInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (input.parentId) await requireDepartment(tx, organizationId, companyId, input.parentId);
    if (input.headId) await requireEmployee(tx, organizationId, companyId, input.headId);
    const d = await tx.department
      .create({ data: { organizationId, companyId, name: input.name, description: nil(input.description), parentId: nil(input.parentId), headId: nil(input.headId), costCenterCode: nil(input.costCenterCode) } })
      .catch((e) => uniqueName(e, "department"));
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.department.created", resourceType: "department", resourceId: d.id, newValue: input });
    return d;
  });
}

export async function updateDepartment(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof departmentPatch>) {
  const input = departmentPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireDepartment(tx, organizationId, companyId, id);
    if (input.parentId) {
      await requireDepartment(tx, organizationId, companyId, input.parentId);
      await assertNoCycle(tx, companyId, id, input.parentId);
    }
    if (input.headId) await requireEmployee(tx, organizationId, companyId, input.headId);
    const d = await tx.department
      .update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: nil(input.description) } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.headId !== undefined ? { headId: input.headId } : {}),
          ...(input.costCenterCode !== undefined ? { costCenterCode: nil(input.costCenterCode) } : {}),
        },
      })
      .catch((e) => uniqueName(e, "department"));
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.department.updated", resourceType: "department", resourceId: id, oldValue: before, newValue: input });
    return d;
  });
}

/** Archive a department; its sub-departments move up to its parent and its employees and teams are detached. */
export async function archiveDepartment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const d = await requireDepartment(tx, organizationId, companyId, id);
    await tx.department.updateMany({ where: { companyId, parentId: id }, data: { parentId: d.parentId } });
    await tx.employee.updateMany({ where: { companyId, departmentId: id }, data: { departmentId: null } });
    await tx.team.updateMany({ where: { companyId, departmentId: id }, data: { departmentId: null } });
    // Free the unique name for reuse.
    await tx.department.update({ where: { id }, data: { archivedAt: new Date(), parentId: null, name: `${d.name} (archived ${d.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.department.archived", resourceType: "department", resourceId: id, oldValue: { name: d.name } });
    return { ok: true };
  });
}

export async function listTeams(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().team.findMany({ take: 500,
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      department: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      members: { where: { archivedAt: null, status: { not: "TERMINATED" } }, select: { id: true, firstName: true, lastName: true, title: true }, orderBy: { firstName: "asc" } },
    },
  });
}

async function requireTeam(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Team");
  const t = await tx.team.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!t) throw notFound("Team");
  return t;
}

export async function createTeam(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof teamInput>) {
  const input = teamInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (input.departmentId) await requireDepartment(tx, organizationId, companyId, input.departmentId);
    if (input.leadId) await requireEmployee(tx, organizationId, companyId, input.leadId);
    const t = await tx.team
      .create({ data: { organizationId, companyId, name: input.name, description: nil(input.description), departmentId: nil(input.departmentId), leadId: nil(input.leadId) } })
      .catch((e) => uniqueName(e, "team"));
    if (input.leadId) await tx.employee.update({ where: { id: input.leadId }, data: { teamId: t.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.team.created", resourceType: "team", resourceId: t.id, newValue: input });
    return t;
  });
}

export async function updateTeam(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof teamPatch>) {
  const input = teamPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireTeam(tx, organizationId, companyId, id);
    if (input.departmentId) await requireDepartment(tx, organizationId, companyId, input.departmentId);
    if (input.leadId) await requireEmployee(tx, organizationId, companyId, input.leadId);
    const t = await tx.team
      .update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: nil(input.description) } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
        },
      })
      .catch((e) => uniqueName(e, "team"));
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.team.updated", resourceType: "team", resourceId: id, oldValue: before, newValue: input });
    return t;
  });
}

export async function archiveTeam(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const t = await requireTeam(tx, organizationId, companyId, id);
    await tx.employee.updateMany({ where: { companyId, teamId: id }, data: { teamId: null } });
    await tx.team.update({ where: { id }, data: { archivedAt: new Date(), name: `${t.name} (archived ${t.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.team.archived", resourceType: "team", resourceId: id, oldValue: { name: t.name } });
    return { ok: true };
  });
}

export async function changeTeamMember(ctx: RequestContext, organizationId: string, companyId: string, teamId: string, raw: z.input<typeof teamMemberInput>) {
  const input = teamMemberInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireTeam(tx, organizationId, companyId, teamId);
    const e = await requireEmployee(tx, organizationId, companyId, input.employeeId);
    if (input.action === "add") await tx.employee.update({ where: { id: e.id }, data: { teamId } });
    else if (e.teamId === teamId) await tx.employee.update({ where: { id: e.id }, data: { teamId: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `hr.team.member_${input.action === "add" ? "added" : "removed"}`, resourceType: "team", resourceId: teamId, newValue: { employeeId: e.id } });
    return { ok: true };
  });
}

/** Everyone in the reporting structure (not terminated/archived), for the org chart. */
export async function orgChartPeople(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().employee.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      status: true,
      managerId: true,
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: "asc" }],
    take: 5000,
  });
}

export interface ChartNode<T> {
  person: T;
  children: ChartNode<T>[];
  /** Total people below this node. */
  size: number;
}

/** Build reporting trees from managerId; people whose manager is missing (or in a cycle) become roots. */
export function buildChart<T extends { id: string; managerId: string | null }>(people: T[]): ChartNode<T>[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const p of people) {
    if (p.managerId && byId.has(p.managerId) && p.managerId !== p.id) kids.set(p.managerId, [...(kids.get(p.managerId) ?? []), p]);
    else roots.push(p);
  }
  const seen = new Set<string>();
  const build = (p: T): ChartNode<T> => {
    seen.add(p.id);
    const children = (kids.get(p.id) ?? []).filter((c) => !seen.has(c.id)).map(build);
    return { person: p, children, size: children.reduce((n, c) => n + 1 + c.size, 0) };
  };
  const trees = roots.map(build);
  // Members of a pure cycle (no root reaches them) are shown as roots so nobody disappears.
  for (const p of people) if (!seen.has(p.id)) trees.push(build(p));
  return trees;
}

/** Roles & reporting overview: designations with headcount, managers with span of control, department heads, team leads. */
export async function rolesOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const active = { archivedAt: null, status: { not: "TERMINATED" as const } };
  const [byTitle, managers, heads, leads, total] = await Promise.all([
    db().employee.groupBy({ by: ["title"], where: { organizationId, companyId, ...active }, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 100 }),
    db().employee.findMany({
      where: { organizationId, companyId, ...active, reports: { some: active } },
      select: { id: true, firstName: true, lastName: true, title: true, _count: { select: { reports: { where: active } } } },
      take: 500,
    }),
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, head: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { name: "asc" } }),
    db().team.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, lead: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { name: "asc" } }),
    db().employee.count({ where: { organizationId, companyId, ...active } }),
  ]);
  return {
    total,
    titles: byTitle.map((r) => ({ title: r.title, count: r._count._all })),
    managers: managers.map((m) => ({ ...m, reports: m._count.reports })).sort((a, b) => b.reports - a.reports),
    heads,
    leads,
  };
}
