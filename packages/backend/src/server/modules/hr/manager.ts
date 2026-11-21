import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { createTask } from "@/server/modules/agents/service";
import { authorize, dayString, employeeName, todayUtc } from "./access";
import { getEmployee } from "./employees";
import { addChecklistItem, CHECKLIST_CATEGORIES, OWNER_ROLES, startChecklistTx } from "./onboarding";
import { performanceOf } from "./performance";

/**
 * The AI HR assistant on employee records: an onboarding plan proposed as checklist steps (approved before they are
 * added), a performance review draft from goals, KPIs and feedback, and the team overview. Reads are deterministic from
 * the records; writes go through the supervised propose_onboarding_plan tool.
 */

export const EMPLOYEE_AI_MODES = ["onboarding_plan", "review_draft"] as const;
export const employeeAssistInput = z.object({ mode: z.enum(EMPLOYEE_AI_MODES), guidance: z.string().trim().max(1000).optional() });
export const teamOverviewInput = z.object({ guidance: z.string().trim().max(1000).optional() });
export const EMPLOYEE_SUBJECT = "hr_employee";

const extra = (g?: string) => (g ? `\n\nAdditional direction from the requester: ${g}` : "");

export async function assistEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof employeeAssistInput>) {
  const input = employeeAssistInput.parse(raw);
  await authorize(ctx, organizationId, companyId, input.mode === "onboarding_plan" ? "hr.manage" : "hr.read");
  const e = await getEmployee(ctx, organizationId, companyId, employeeId);
  const name = employeeName(e);
  const instructions =
    input.mode === "onboarding_plan"
      ? `Call read_employee_record with employeeId ${e.id}. Design a practical onboarding plan for ${name} for their first 30/60/90 days: access and accounts, documents, equipment, training on the company's products and processes (use search_company_brain), introductions, and first goals. Do not repeat steps that are already on their onboarding checklist. Then propose the steps with propose_onboarding_plan (employeeId ${e.id}; 5–15 steps, each with a category, an owner role and a due date relative to the start date ${dayString(e.startDate) || "today"}). A person approves the plan before the steps are added. Finish with a short summary of the plan.`
      : `Call read_employee_record with employeeId ${e.id}. Draft a balanced performance review for ${name} from their real goals (status and progress), KPIs (target vs actual), feedback received and development plans: (1) summary, (2) achievements tied to specific goals or KPIs, (3) areas to develop with concrete examples from the records, (4) suggested rating 1–5 with a one-line justification, (5) 2–3 goals for the next period. Quote the figures you rely on; where records are missing, say so instead of guessing. Do not include anything about protected characteristics, health or private life. This is a draft for the manager to edit — do not change any records.`;
  return createTask(ctx, organizationId, companyId, {
    profile: "hr_manager",
    title: `${input.mode === "onboarding_plan" ? "Onboarding plan" : "Performance review draft"}: ${name}`.slice(0, 200),
    instructions: instructions + extra(input.guidance),
    subject: { type: EMPLOYEE_SUBJECT, id: e.id },
  });
}

export async function requestTeamOverview(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof teamOverviewInput>) {
  const input = teamOverviewInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "hr.read");
  return createTask(ctx, organizationId, companyId, {
    profile: "hr_manager",
    title: "Team overview",
    subject: { type: "hr_insights", id: companyId },
    instructions:
      "Call read_team_overview and read_headcount_summary, then write a team overview for the founder: (1) the team at a glance per department, (2) where people need attention (goals at risk, overdue reviews, onboarding running late, people on leave, managers with large teams), (3) hiring status, (4) the five most useful HR actions for the next two weeks, each with an owner. Use the numbers from the tools only." +
      extra(input.guidance),
  });
}

/** Per-department snapshot from the records: headcount, on leave today, onboarding, goals at risk, pending reviews, open roles. */
export async function teamOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const today = todayUtc();
  const base = { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" as const } };
  const [departments, people, leave, onboarding, goalsAtRisk, reviews, jobs] = await Promise.all([
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true } }),
    db().employee.findMany({ where: base, select: { id: true, departmentId: true, managerId: true, startDate: true } }),
    db().hrLeaveRequest.findMany({ where: { organizationId, companyId, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, select: { employeeId: true } }),
    db().hrChecklist.findMany({ where: { organizationId, companyId, kind: "ONBOARDING", status: "IN_PROGRESS" }, select: { employeeId: true, items: { select: { dueDate: true, completedAt: true } } } }),
    db().hrGoal.findMany({ where: { companyId, status: "AT_RISK" }, select: { employeeId: true } }),
    db().hrReview.findMany({ where: { companyId, status: { not: "COMPLETED" }, cycle: { status: "ACTIVE" } }, select: { employeeId: true } }),
    db().hrJob.findMany({ where: { organizationId, companyId, status: "OPEN" }, select: { departmentId: true, openings: true } }),
  ]);
  const deptOf = new Map(people.map((p) => [p.id, p.departmentId]));
  const rows = new Map<string | null, { name: string | null; headcount: number; onLeave: number; onboarding: number; onboardingLate: number; goalsAtRisk: number; reviewsPending: number; openRoles: number }>();
  const row = (id: string | null) => {
    let r = rows.get(id);
    if (!r) {
      r = { name: id ? (departments.find((d) => d.id === id)?.name ?? null) : null, headcount: 0, onLeave: 0, onboarding: 0, onboardingLate: 0, goalsAtRisk: 0, reviewsPending: 0, openRoles: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const p of people) row(p.departmentId).headcount++;
  for (const l of leave) if (deptOf.has(l.employeeId)) row(deptOf.get(l.employeeId) ?? null).onLeave++;
  for (const c of onboarding) {
    const r = row(deptOf.get(c.employeeId) ?? null);
    r.onboarding++;
    if (c.items.some((i) => !i.completedAt && i.dueDate && i.dueDate < today)) r.onboardingLate++;
  }
  for (const g of goalsAtRisk) if (deptOf.has(g.employeeId)) row(deptOf.get(g.employeeId) ?? null).goalsAtRisk++;
  for (const rv of reviews) if (deptOf.has(rv.employeeId)) row(deptOf.get(rv.employeeId) ?? null).reviewsPending++;
  for (const j of jobs) row(j.departmentId ?? null).openRoles += j.openings;
  const spans = new Map<string, number>();
  for (const p of people) if (p.managerId) spans.set(p.managerId, (spans.get(p.managerId) ?? 0) + 1);
  return {
    departments: [...rows.values()].sort((a, b) => b.headcount - a.headcount),
    headcount: people.length,
    largestTeam: Math.max(0, ...spans.values()),
    managersOver8: [...spans.values()].filter((n) => n > 8).length,
  };
}

/** The record the AI assistant reads for one employee (no salary, no personal contact data). */
export async function employeeRecordForAi(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const e = await getEmployee(ctx, organizationId, companyId, employeeId);
  const perf = await performanceOf(ctx, organizationId, companyId, employeeId).catch(() => null);
  const checklist = await db().hrChecklist.findFirst({
    where: { organizationId, companyId, employeeId, kind: "ONBOARDING", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { status: true, items: { orderBy: { position: "asc" }, select: { title: true, category: true, ownerRole: true, dueDate: true, completedAt: true } } },
  });
  const lines = [
    `Employee ${e.id}: ${employeeName(e)} — ${e.title ?? "no title"}${e.department ? `, ${e.department.name}` : ""}${e.designation ? `, ${e.designation.name}` : ""}, status ${e.status}, type ${e.employmentType}, start ${dayString(e.startDate) || "unknown"}.`,
    checklist
      ? `Onboarding checklist (${checklist.status}):\n${checklist.items.map((i) => `- [${i.completedAt ? "x" : " "}] ${i.title} (${i.category}, ${i.ownerRole}${i.dueDate ? `, due ${dayString(i.dueDate)}` : ""})`).join("\n") || "- no steps"}`
      : "No onboarding checklist yet.",
  ];
  if (perf) {
    lines.push(perf.goals.length ? `Goals:\n${perf.goals.map((g) => `- ${g.title}: ${g.status}, ${g.progress}%${g.dueDate ? `, due ${dayString(g.dueDate)}` : ""}${g.objective ? ` (objective: ${g.objective.title})` : ""}`).join("\n")}` : "No goals recorded.");
    lines.push(perf.kpis.length ? `KPIs:\n${perf.kpis.map((k) => `- ${k.name} ${k.period}: target ${k.target}${k.unit ? ` ${k.unit}` : ""}, actual ${k.actual ?? "not recorded"}`).join("\n")}` : "No KPIs recorded.");
    lines.push(perf.feedback.length ? `Feedback:\n${perf.feedback.slice(0, 20).map((f) => `- ${dayString(f.createdAt)} ${f.kind}: ${f.body.slice(0, 400)}`).join("\n")}` : "No feedback recorded.");
    lines.push(perf.plans.length ? `Development plans:\n${perf.plans.map((p) => `- ${p.title} (${p.status})`).join("\n")}` : "No development plans.");
    lines.push(perf.reviews.length ? `Reviews:\n${perf.reviews.slice(0, 5).map((r) => `- ${r.cycle.name}: ${r.status}${r.managerRating != null ? `, manager rating ${r.managerRating}` : ""}`).join("\n")}` : "No previous reviews.");
  } else lines.push("Performance records are not visible to the requester.");
  return lines.join("\n\n");
}

export const onboardingPlanInput = z.object({
  employeeId: z.string().uuid(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        category: z.enum(CHECKLIST_CATEGORIES).default("GENERAL"),
        ownerRole: z.enum(OWNER_ROLES).default("HR"),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .min(1)
    .max(25),
});

/** Adds the approved plan to the employee's onboarding checklist (opened if none), each step with its WorkTask. */
export async function applyOnboardingPlan(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof onboardingPlanInput>) {
  const input = onboardingPlanInput.parse(raw);
  const list = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    return startChecklistTx(tx, ctx, organizationId, companyId, { employeeId: input.employeeId, kind: "ONBOARDING" });
  });
  const existing = new Set((await db().hrChecklistItem.findMany({ where: { checklistId: list.id }, select: { title: true } })).map((i) => i.title.trim().toLowerCase()));
  let added = 0;
  for (const s of input.steps) {
    if (existing.has(s.title.trim().toLowerCase())) continue;
    await addChecklistItem(ctx, organizationId, companyId, list.id, s);
    added++;
  }
  return { checklistId: list.id, added };
}
