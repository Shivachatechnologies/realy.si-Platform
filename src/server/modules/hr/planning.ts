import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { createTask } from "@/server/modules/agents/service";
import { actorId, authorize, day, isUuid, money, optText, patchText, toDay, toMinor, uuid } from "./access";
import { EMPLOYMENT_TYPES } from "./employees";
import { startHiring } from "./hiring";

/**
 * Workforce planning: planned roles (headcount) per department and quarter with their yearly cost, compared with the
 * people the company has today. A plan moves PLANNED → APPROVED → HIRING (a real job + guided hiring journey is opened
 * through startHiring) → FILLED (when the job's openings are hired) or CANCELLED.
 */

export const PLAN_STATUSES = ["PLANNED", "APPROVED", "HIRING", "FILLED", "CANCELLED"] as const;
export const PLAN_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const PLANNING_SUBJECT = "hr_workforce_plan";

const emptyU = z.literal("").transform(() => undefined);

export const headcountInput = z.object({
  title: z.string().trim().min(2).max(160),
  departmentId: uuid.optional().or(emptyU),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  headcount: z.coerce.number().int().min(1).max(500).default(1),
  targetStart: day,
  annualCost: money.optional().or(emptyU),
  priority: z.enum(PLAN_PRIORITIES).default("MEDIUM"),
  reason: optText(2000),
});
export const headcountPatch = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  departmentId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
  targetStart: day.optional(),
  annualCost: money.optional().or(emptyU),
  priority: z.enum(PLAN_PRIORITIES).optional(),
  reason: patchText(2000),
  status: z.enum(["PLANNED", "APPROVED", "FILLED", "CANCELLED"]).optional(),
});
export const planningAssistInput = z.object({ guidance: z.string().trim().max(1500).optional() });

/** First day of the quarter containing `d` (UTC). */
export function quarterStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
}
export const quarterKey = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

async function requireDepartment(organizationId: string, companyId: string, id: string | null | undefined) {
  if (!id) return;
  const d = await db().department.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, select: { id: true } });
  if (!d) throw notFound("Department");
}

async function requirePlan(organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Headcount plan");
  const p = await db().hrHeadcountPlan.findFirst({ where: { id, organizationId, companyId } });
  if (!p) throw notFound("Headcount plan");
  return p;
}

/** Planned roles + today's headcount per department + quarter totals (cost and people). */
export async function workforcePlan(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const [plans, departments, employees, company] = await Promise.all([
    db().hrHeadcountPlan.findMany({
      where: { organizationId, companyId },
      orderBy: [{ targetStart: "asc" }, { createdAt: "asc" }],
      take: 500,
      include: { job: { select: { id: true, title: true, status: true, openings: true, candidates: { where: { stage: "HIRED" }, select: { id: true } } } } },
    }),
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db().employee.groupBy({ by: ["departmentId"], where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" } }, _count: { _all: true } }),
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } }),
  ]);
  const active = plans.filter((p) => p.status !== "CANCELLED" && p.status !== "FILLED");
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = new Map<string, { id: string | null; name: string | null; current: number; planned: number; annualCostMinor: bigint }>();
  const key = (id: string | null) => id ?? "none";
  for (const d of departments) byDept.set(d.id, { id: d.id, name: d.name, current: 0, planned: 0, annualCostMinor: 0n });
  for (const e of employees) {
    const k = key(e.departmentId);
    const row = byDept.get(k) ?? { id: e.departmentId, name: e.departmentId ? (deptName.get(e.departmentId) ?? null) : null, current: 0, planned: 0, annualCostMinor: 0n };
    row.current += e._count._all;
    byDept.set(k, row);
  }
  for (const p of active) {
    const k = key(p.departmentId);
    const row = byDept.get(k) ?? { id: p.departmentId, name: p.departmentId ? (deptName.get(p.departmentId) ?? null) : null, current: 0, planned: 0, annualCostMinor: 0n };
    row.planned += p.headcount;
    row.annualCostMinor += p.annualCostMinor * BigInt(p.headcount);
    byDept.set(k, row);
  }
  const quarters = new Map<string, { key: string; start: Date; people: number; annualCostMinor: bigint }>();
  for (const p of active) {
    const k = quarterKey(p.targetStart);
    const q = quarters.get(k) ?? { key: k, start: quarterStart(p.targetStart), people: 0, annualCostMinor: 0n };
    q.people += p.headcount;
    q.annualCostMinor += p.annualCostMinor * BigInt(p.headcount);
    quarters.set(k, q);
  }
  const currentHeadcount = employees.reduce((s, e) => s + e._count._all, 0);
  const plannedPeople = active.reduce((s, p) => s + p.headcount, 0);
  const plannedAnnualCost = active.reduce((s, p) => s + p.annualCostMinor * BigInt(p.headcount), 0n);
  return {
    currency: company.baseCurrency,
    plans: plans.map((p) => ({ ...p, departmentName: p.departmentId ? (deptName.get(p.departmentId) ?? null) : null, hired: p.job?.candidates.length ?? 0 })),
    departments: [...byDept.values()].filter((d) => d.current || d.planned).sort((a, b) => b.current + b.planned - (a.current + a.planned)),
    quarters: [...quarters.values()].sort((a, b) => a.start.getTime() - b.start.getTime()),
    departmentOptions: departments,
    totals: { currentHeadcount, plannedPeople, plannedAnnualCost, monthlyCost: plannedAnnualCost / 12n, approved: active.filter((p) => p.status === "APPROVED").length, hiring: active.filter((p) => p.status === "HIRING").length },
  };
}

export async function createHeadcountPlan(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof headcountInput>) {
  const input = headcountInput.parse(raw);
  await requireDepartment(organizationId, companyId, input.departmentId);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const plan = await tx.hrHeadcountPlan.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        departmentId: input.departmentId ?? null,
        employmentType: input.employmentType,
        headcount: input.headcount,
        targetStart: quarterStart(toDay(input.targetStart)!),
        annualCostMinor: toMinor(input.annualCost, company.baseCurrency) ?? 0n,
        currency: company.baseCurrency,
        priority: input.priority,
        reason: input.reason ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.headcount_plan.created", resourceType: "hr_headcount_plan", resourceId: plan.id, newValue: { title: plan.title, headcount: plan.headcount, targetStart: plan.targetStart } });
    return plan;
  });
}

export async function updateHeadcountPlan(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof headcountPatch>) {
  const input = headcountPatch.parse(raw);
  if (input.departmentId) await requireDepartment(organizationId, companyId, input.departmentId);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const p = await requirePlan(organizationId, companyId, id);
    if (input.status === "APPROVED" && p.status !== "PLANNED") throw conflict("Only planned roles can be approved", { reason: "hr_plan_state" });
    if (input.status === "PLANNED" && p.status === "HIRING") throw conflict("A role that is being hired can't go back to planned", { reason: "hr_plan_state" });
    const updated = await tx.hrHeadcountPlan.update({
      where: { id: p.id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.employmentType ? { employmentType: input.employmentType } : {}),
        ...(input.headcount ? { headcount: input.headcount } : {}),
        ...(input.targetStart ? { targetStart: quarterStart(toDay(input.targetStart)!) } : {}),
        ...(input.annualCost !== undefined ? { annualCostMinor: toMinor(input.annualCost, p.currency) ?? 0n } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.reason !== undefined ? { reason: input.reason || null } : {}),
        ...(input.status ? { status: input.status, ...(input.status === "APPROVED" ? { approvedById: actorId(ctx, organizationId) } : {}) } : {}),
      },
    });
    if (input.status === "APPROVED") {
      const recipients = (await usersWithPermission(tx, organizationId, companyId, "hr.manage")).filter((u) => u !== ctx.actor.id);
      await notifyUsers(tx, organizationId, recipients, "hr.headcount_approved", { companyId, title: updated.title, href: "/hr/planning" });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.headcount_plan.updated", resourceType: "hr_headcount_plan", resourceId: p.id, oldValue: { status: p.status }, newValue: input });
    return updated;
  });
}

export async function deleteHeadcountPlan(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const p = await requirePlan(organizationId, companyId, id);
    if (p.jobId) throw conflict("This role already has a job; cancel it instead", { reason: "hr_plan_has_job" });
    await tx.hrHeadcountPlan.delete({ where: { id: p.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.headcount_plan.deleted", resourceType: "hr_headcount_plan", resourceId: p.id, oldValue: { title: p.title } });
    return { ok: true };
  });
}

/** Start hiring for a planned role: opens a draft job + the guided hiring journey (startHiring) and links it. */
export async function startHiringFromPlan(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const p = await requirePlan(organizationId, companyId, id);
  if (p.jobId) return { id: p.jobId, jobId: p.jobId, planId: p.id };
  if (p.status === "CANCELLED" || p.status === "FILLED") throw invalid("This role is closed", { reason: "hr_plan_state" });
  const brief = (p.reason?.trim() || `We plan to hire ${p.headcount} × ${p.title}.`).slice(0, 3000);
  const started = await startHiring(ctx, organizationId, companyId, {
    title: p.title,
    brief: brief.length >= 5 ? brief : `${brief} role`,
    employmentType: p.employmentType,
    openings: Math.min(p.headcount, 50),
    departmentId: p.departmentId ?? undefined,
  });
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await tx.hrHeadcountPlan.update({ where: { id: p.id }, data: { jobId: started.jobId, status: "HIRING" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.headcount_plan.hiring", resourceType: "hr_headcount_plan", resourceId: p.id, newValue: { jobId: started.jobId } });
  });
  return { id: started.jobId, jobId: started.jobId, planId: p.id };
}

/** Worker: plans whose job has hired all its openings become FILLED (idempotent). */
export async function syncFilledPlans(): Promise<number> {
  const hiring = await db().hrHeadcountPlan.findMany({
    where: { status: "HIRING", jobId: { not: null } },
    take: 1000,
    select: { id: true, headcount: true, job: { select: { candidates: { where: { stage: "HIRED" }, select: { id: true } } } } },
  });
  const done = hiring.filter((p) => (p.job?.candidates.length ?? 0) >= p.headcount).map((p) => p.id);
  if (!done.length) return 0;
  const { count } = await db().hrHeadcountPlan.updateMany({ where: { id: { in: done }, status: "HIRING" }, data: { status: "FILLED" } });
  return count;
}

/** "Help me plan": the people analyst reviews headcount, hiring and the plan and proposes roles (a real agent task). */
export async function requestPlanningHelp(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planningAssistInput>) {
  const input = planningAssistInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const plans = await db().hrHeadcountPlan.findMany({ where: { organizationId, companyId, status: { in: ["PLANNED", "APPROVED", "HIRING"] } }, select: { title: true, headcount: true, targetStart: true, priority: true, status: true }, take: 50 });
  const planText = plans.length ? plans.map((p) => `- ${p.headcount} × ${p.title} (${quarterKey(p.targetStart)}, ${p.priority}, ${p.status})`).join("\n") : "(no planned roles yet)";
  return createTask(ctx, organizationId, companyId, {
    profile: "people_analyst",
    title: "Workforce plan review",
    instructions: `Review this company's workforce plan. Call read_headcount_summary, read_open_jobs and read_workforce_plan (and read_objectives if available) first. Then, in plain language for a founder who has never done workforce planning: (1) summarise today's team by department, (2) point out gaps or risks in the plan below (too many hires at once, missing roles for the company's objectives, manager span of control), (3) recommend which roles to hire next and in which quarter, with a short reason each. You may add each recommended role with propose_planned_role (it is saved as PLANNED and a person approves it). Use only the data the tools return; separate facts from suggestions. Do not invent salaries.\n\nCurrent plan:\n${planText}${input.guidance ? `\n\nThe founder adds: ${input.guidance}` : ""}`,
    subject: { type: PLANNING_SUBJECT, id: companyId },
  });
}
