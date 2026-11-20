import { z } from "zod";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { authorize, day, isInReportingLine, isUuid, myEmployee, optText, patchText, requireEmployee, toDay, uuid } from "./access";

/** Performance: KPIs, goals (optionally linked to company objectives), review cycles and reviews, feedback, development plans. */

export const GOAL_STATUSES = ["NOT_STARTED", "ON_TRACK", "AT_RISK", "COMPLETED", "CANCELLED"] as const;
export const CYCLE_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
export const FEEDBACK_KINDS = ["PRAISE", "CONSTRUCTIVE", "NOTE"] as const;
export const PLAN_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

const emptyU = z.literal("").transform(() => undefined);
const emptyN = z.literal("").transform(() => null);
const nil = (v?: string | null) => (v ? v : null);

export const kpiInput = z.object({
  employeeId: uuid,
  name: z.string().trim().min(1).max(160),
  unit: optText(30),
  period: z.string().trim().min(1).max(30),
  target: z.coerce.number().finite(),
  actual: z.coerce.number().finite().optional().or(emptyU),
});
export const kpiPatch = z.object({ actual: z.coerce.number().finite().nullable().optional(), target: z.coerce.number().finite().optional(), name: z.string().trim().min(1).max(160).optional() });
export const goalInput = z.object({
  employeeId: uuid,
  title: z.string().trim().min(1).max(200),
  description: optText(2000),
  objectiveId: uuid.optional().or(emptyU),
  dueDate: day.optional().or(emptyU),
});
export const goalPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: patchText(2000),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  dueDate: day.nullable().optional().or(emptyN),
  objectiveId: uuid.nullable().optional().or(emptyN),
});
export const cycleInput = z.object({ name: z.string().trim().min(1).max(120), startDate: day, endDate: day });
export const cyclePatch = z.object({ status: z.enum(CYCLE_STATUSES).optional(), name: z.string().trim().min(1).max(120).optional() });
export const reviewSubmitInput = z.object({
  as: z.enum(["self", "manager"]),
  rating: z.coerce.number().int().min(1).max(5),
  comments: z.string().trim().min(1).max(10_000),
});
export const feedbackInput = z.object({ employeeId: uuid, kind: z.enum(FEEDBACK_KINDS).default("PRAISE"), body: z.string().trim().min(1).max(5000), isPrivate: z.boolean().default(false) });
export const planInput = z.object({ employeeId: uuid, title: z.string().trim().min(1).max(200), focusArea: optText(200), actions: z.string().trim().max(5000).default(""), dueDate: day.optional().or(emptyU) });
export const planPatch = z.object({ status: z.enum(PLAN_STATUSES).optional(), actions: z.string().trim().max(5000).optional(), title: z.string().trim().min(1).max(200).optional() });

/** Viewer's relation to an employee: HR manager, the employee, or a manager above them. */
export async function relationTo(client: Tx | Db, ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read", client);
  const manage = await can(ctx, "hr.manage", chain, client);
  const me = await myEmployee(client, ctx, organizationId, companyId);
  const isSelf = me?.id === employeeId;
  const isManager = !!me && !isSelf && (await isInReportingLine(client, companyId, employeeId, me.id));
  return { manage, isSelf, isManager, me };
}

async function requireLead(client: Tx, ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, allowSelf = false) {
  const r = await relationTo(client, ctx, organizationId, companyId, employeeId);
  if (!(r.manage || r.isManager || (allowSelf && r.isSelf))) throw forbidden("Only HR or the employee's manager can do this", { reason: "hr_not_manager" });
  return r;
}

export async function performanceOf(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  await requireEmployee(db(), organizationId, companyId, employeeId, { includeArchived: true });
  const r = await relationTo(db(), ctx, organizationId, companyId, employeeId);
  if (!(r.manage || r.isSelf || r.isManager)) throw forbidden("Not visible", { reason: "hr_not_manager" });
  const [kpis, goals, reviews, feedback, plans] = await Promise.all([
    db().hrKpi.findMany({ where: { employeeId, companyId }, orderBy: [{ period: "desc" }, { name: "asc" }], take: 100 }),
    db().hrGoal.findMany({ where: { employeeId, companyId }, orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }], take: 100 }),
    db().hrReview.findMany({ where: { employeeId, companyId }, orderBy: { createdAt: "desc" }, take: 50, include: { cycle: { select: { id: true, name: true, status: true } }, reviewer: { select: { id: true, firstName: true, lastName: true } } } }),
    db().hrFeedback.findMany({ where: { employeeId, companyId, ...(r.manage || r.isManager ? {} : { isPrivate: false }) }, orderBy: { createdAt: "desc" }, take: 100 }),
    db().hrDevelopmentPlan.findMany({ where: { employeeId, companyId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const authorIds = [...new Set(feedback.map((f) => f.authorId).filter((v): v is string => !!v))];
  const authors = authorIds.length ? await db().user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const objectiveIds = [...new Set(goals.map((g) => g.objectiveId).filter((v): v is string => !!v))];
  const objectives = objectiveIds.length ? await db().objective.findMany({ where: { id: { in: objectiveIds }, companyId }, select: { id: true, title: true } }) : [];
  return {
    kpis,
    goals: goals.map((g) => ({ ...g, objective: objectives.find((o) => o.id === g.objectiveId) ?? null })),
    // Manager ratings stay hidden from the employee until the review is completed.
    reviews: reviews.map((rv) => (r.isSelf && !r.manage && rv.status !== "COMPLETED" ? { ...rv, managerRating: null, managerComments: null } : rv)),
    feedback: feedback.map((f) => ({ ...f, authorName: authors.find((a) => a.id === f.authorId)?.name ?? null })),
    plans,
    access: { manage: r.manage, isSelf: r.isSelf, isManager: r.isManager, canLead: r.manage || r.isManager },
  };
}

export async function objectiveOptions(organizationId: string, companyId: string) {
  return db().objective.findMany({ where: { organizationId, companyId, status: "ACTIVE" }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 200 });
}

export async function createKpi(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof kpiInput>) {
  const input = kpiInput.parse(raw);
  return transaction(async (tx) => {
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    await requireLead(tx, ctx, organizationId, companyId, input.employeeId);
    const k = await tx.hrKpi.create({ data: { organizationId, companyId, employeeId: input.employeeId, name: input.name, unit: nil(input.unit), period: input.period, target: input.target, actual: input.actual ?? null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.kpi.created", resourceType: "hr_kpi", resourceId: k.id, newValue: input });
    return k;
  });
}

export async function updateKpi(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof kpiPatch>) {
  const input = kpiPatch.parse(raw);
  return transaction(async (tx) => {
    const k = isUuid(id) ? await tx.hrKpi.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!k) throw notFound("KPI");
    await requireLead(tx, ctx, organizationId, companyId, k.employeeId);
    const updated = await tx.hrKpi.update({ where: { id }, data: { ...(input.actual !== undefined ? { actual: input.actual } : {}), ...(input.target !== undefined ? { target: input.target } : {}), ...(input.name ? { name: input.name } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.kpi.updated", resourceType: "hr_kpi", resourceId: id, newValue: input });
    return updated;
  });
}

export async function deleteKpi(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    const k = isUuid(id) ? await tx.hrKpi.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!k) throw notFound("KPI");
    await requireLead(tx, ctx, organizationId, companyId, k.employeeId);
    await tx.hrKpi.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.kpi.deleted", resourceType: "hr_kpi", resourceId: id });
    return { ok: true };
  });
}

async function checkObjective(tx: Tx, organizationId: string, companyId: string, objectiveId?: string | null) {
  if (objectiveId && !(await tx.objective.findFirst({ where: { id: objectiveId, organizationId, companyId }, select: { id: true } }))) throw notFound("Objective");
}

export async function createGoal(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof goalInput>) {
  const input = goalInput.parse(raw);
  return transaction(async (tx) => {
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    await requireLead(tx, ctx, organizationId, companyId, input.employeeId, true);
    await checkObjective(tx, organizationId, companyId, input.objectiveId);
    const g = await tx.hrGoal.create({ data: { organizationId, companyId, employeeId: input.employeeId, title: input.title, description: nil(input.description), objectiveId: nil(input.objectiveId), dueDate: toDay(input.dueDate) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.goal.created", resourceType: "hr_goal", resourceId: g.id, newValue: input });
    return g;
  });
}

export async function updateGoal(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof goalPatch>) {
  const input = goalPatch.parse(raw);
  return transaction(async (tx) => {
    const g = isUuid(id) ? await tx.hrGoal.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!g) throw notFound("Goal");
    await requireLead(tx, ctx, organizationId, companyId, g.employeeId, true);
    if (input.objectiveId) await checkObjective(tx, organizationId, companyId, input.objectiveId);
    const progress = input.status === "COMPLETED" ? 100 : input.progress;
    const updated = await tx.hrGoal.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: nil(input.description) } : {}),
        ...(progress !== undefined ? { progress } : {}),
        ...(input.status ? { status: input.status } : progress === 100 ? { status: "COMPLETED" } : progress && g.status === "NOT_STARTED" ? { status: "ON_TRACK" } : {}),
        ...(input.dueDate !== undefined ? { dueDate: toDay(input.dueDate) } : {}),
        ...(input.objectiveId !== undefined ? { objectiveId: input.objectiveId } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.goal.updated", resourceType: "hr_goal", resourceId: id, newValue: input });
    return updated;
  });
}

export async function deleteGoal(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    const g = isUuid(id) ? await tx.hrGoal.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!g) throw notFound("Goal");
    await requireLead(tx, ctx, organizationId, companyId, g.employeeId);
    await tx.hrGoal.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.goal.deleted", resourceType: "hr_goal", resourceId: id });
    return { ok: true };
  });
}

// ─── Review cycles & reviews ────────────────────────────────────────────────────────────────────────────────────────

export async function listCycles(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const cycles = await db().hrReviewCycle.findMany({ where: { organizationId, companyId }, orderBy: { startDate: "desc" }, take: 100 });
  const counts = await db().hrReview.groupBy({ by: ["cycleId", "status"], where: { companyId, cycleId: { in: cycles.map((c) => c.id) } }, _count: { _all: true } });
  return cycles.map((c) => {
    const mine = counts.filter((x) => x.cycleId === c.id);
    return { ...c, total: mine.reduce((n, x) => n + x._count._all, 0), completed: mine.find((x) => x.status === "COMPLETED")?._count._all ?? 0 };
  });
}

export async function getCycle(ctx: RequestContext, organizationId: string, companyId: string, cycleId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(cycleId)) throw notFound("Review cycle");
  const c = await db().hrReviewCycle.findFirst({
    where: { id: cycleId, organizationId, companyId },
    include: {
      reviews: {
        orderBy: { employee: { firstName: "asc" } },
        include: { employee: { select: { id: true, firstName: true, lastName: true, title: true } }, reviewer: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!c) throw notFound("Review cycle");
  return c;
}

export async function createCycle(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof cycleInput>) {
  const input = cycleInput.parse(raw);
  if (input.endDate < input.startDate) throw invalid("The end date is before the start date", { reason: "hr_date_range" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const c = await tx.hrReviewCycle.create({ data: { organizationId, companyId, name: input.name, startDate: toDay(input.startDate)!, endDate: toDay(input.endDate)! } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.review_cycle.created", resourceType: "hr_review_cycle", resourceId: c.id, newValue: input });
    return c;
  });
}

/** Activating a cycle creates a review for every active employee (reviewer = their manager) and notifies them. */
export async function updateCycle(ctx: RequestContext, organizationId: string, companyId: string, cycleId: string, raw: z.input<typeof cyclePatch>) {
  const input = cyclePatch.parse(raw);
  return transaction(
    async (tx) => {
      await authorize(ctx, organizationId, companyId, "hr.manage", tx);
      const c = isUuid(cycleId) ? await tx.hrReviewCycle.findFirst({ where: { id: cycleId, organizationId, companyId } }) : null;
      if (!c) throw notFound("Review cycle");
      if (input.status === "DRAFT" && c.status !== "DRAFT") throw invalid("A launched cycle can't go back to draft");
      const updated = await tx.hrReviewCycle.update({ where: { id: cycleId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.status ? { status: input.status } : {}) } });
      let created = 0;
      if (input.status === "ACTIVE" && c.status === "DRAFT") {
        const people = await tx.employee.findMany({ where: { organizationId, companyId, archivedAt: null, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, managerId: true, userId: true, firstName: true } });
        const res = await tx.hrReview.createMany({ data: people.map((p) => ({ organizationId, companyId, cycleId, employeeId: p.id, reviewerId: p.managerId })), skipDuplicates: true });
        created = res.count;
        await notifyUsers(tx, organizationId, people.map((p) => p.userId), "hr.review_requested", { companyId, title: c.name, href: "/hr/me" });
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.review_cycle.updated", resourceType: "hr_review_cycle", resourceId: cycleId, oldValue: { status: c.status }, newValue: { ...input, reviewsCreated: created } });
      return { ...updated, reviewsCreated: created };
    },
    { timeout: 60_000 },
  );
}

/** Self review by the employee, then manager review by the reviewer (or HR); completes the review. */
export async function submitReview(ctx: RequestContext, organizationId: string, companyId: string, reviewId: string, raw: z.input<typeof reviewSubmitInput>) {
  const input = reviewSubmitInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const rv = isUuid(reviewId) ? await tx.hrReview.findFirst({ where: { id: reviewId, organizationId, companyId }, include: { cycle: true, employee: { select: { userId: true, firstName: true } } } }) : null;
    if (!rv) throw notFound("Review");
    if (rv.cycle.status !== "ACTIVE") throw invalid("This review cycle is not active", { reason: "hr_cycle_inactive" });
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    if (input.as === "self") {
      if (me?.id !== rv.employeeId) throw forbidden("Only the employee can write the self review");
      if (rv.status === "COMPLETED") throw invalid("This review is completed");
      await tx.hrReview.update({ where: { id: reviewId }, data: { selfRating: input.rating, selfComments: input.comments, selfSubmittedAt: new Date(), status: "PENDING_MANAGER" } });
      if (rv.reviewerId) {
        const reviewer = await tx.employee.findFirst({ where: { id: rv.reviewerId }, select: { userId: true } });
        await notifyUsers(tx, organizationId, [reviewer?.userId], "hr.review_requested", { companyId, title: `${rv.cycle.name} — ${rv.employee.firstName}`, href: `/hr/employees/${rv.employeeId}?tab=performance` });
      }
    } else {
      const manage = await can(ctx, "hr.manage", await companyChain(tx, organizationId, companyId), tx);
      if (!(manage || (me && me.id === rv.reviewerId))) throw forbidden("Only the reviewer or HR can write the manager review", { reason: "hr_not_manager" });
      if (me?.id === rv.employeeId) throw forbidden("You can't review yourself");
      await tx.hrReview.update({ where: { id: reviewId }, data: { managerRating: input.rating, managerComments: input.comments, status: "COMPLETED", completedAt: new Date() } });
      await notifyUsers(tx, organizationId, [rv.employee.userId], "hr.review_completed", { companyId, title: rv.cycle.name, href: "/hr/me" });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `hr.review.${input.as}_submitted`, resourceType: "hr_review", resourceId: reviewId, newValue: { rating: input.rating } });
    return { ok: true };
  });
}

/** Reviews waiting for the viewer (their own self review and reviews of their reports). */
export async function myPendingReviews(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (!me) return { self: [], asReviewer: [] };
  const [self, asReviewer] = await Promise.all([
    db().hrReview.findMany({ where: { companyId, employeeId: me.id, status: "PENDING_SELF", cycle: { status: "ACTIVE" } }, include: { cycle: { select: { name: true, endDate: true } } } }),
    db().hrReview.findMany({
      where: { companyId, reviewerId: me.id, status: { in: ["PENDING_SELF", "PENDING_MANAGER"] }, cycle: { status: "ACTIVE" } },
      include: { cycle: { select: { name: true, endDate: true } }, employee: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  return { self, asReviewer };
}

export async function giveFeedback(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof feedbackInput>) {
  const input = feedbackInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const e = await requireEmployee(tx, organizationId, companyId, input.employeeId);
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    if (me?.id === e.id) throw invalid("You can't give feedback to yourself");
    const f = await tx.hrFeedback.create({ data: { organizationId, companyId, employeeId: e.id, kind: input.kind, body: input.body, isPrivate: input.isPrivate, authorId: ctx.actor.id } });
    if (!input.isPrivate) await notifyUsers(tx, organizationId, [e.userId], "hr.feedback_received", { companyId, title: e.firstName, href: "/hr/me" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.feedback.given", resourceType: "hr_feedback", resourceId: f.id, newValue: { employeeId: e.id, kind: input.kind, isPrivate: input.isPrivate } });
    return f;
  });
}

export async function createPlan(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planInput>) {
  const input = planInput.parse(raw);
  return transaction(async (tx) => {
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    await requireLead(tx, ctx, organizationId, companyId, input.employeeId);
    const p = await tx.hrDevelopmentPlan.create({ data: { organizationId, companyId, employeeId: input.employeeId, title: input.title, focusArea: nil(input.focusArea), actions: input.actions, dueDate: toDay(input.dueDate) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.development_plan.created", resourceType: "hr_development_plan", resourceId: p.id, newValue: input });
    return p;
  });
}

export async function updatePlan(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof planPatch>) {
  const input = planPatch.parse(raw);
  return transaction(async (tx) => {
    const p = isUuid(id) ? await tx.hrDevelopmentPlan.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!p) throw notFound("Development plan");
    await requireLead(tx, ctx, organizationId, companyId, p.employeeId);
    const updated = await tx.hrDevelopmentPlan.update({ where: { id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.actions !== undefined ? { actions: input.actions } : {}), ...(input.title ? { title: input.title } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.development_plan.updated", resourceType: "hr_development_plan", resourceId: id, newValue: input });
    return updated;
  });
}

/** Company-wide goal and review overview (HR). */
export async function performanceOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const [goalsByStatus, recentFeedback, avgRatings] = await Promise.all([
    db().hrGoal.groupBy({ by: ["status"], where: { organizationId, companyId }, _count: { _all: true } }),
    db().hrFeedback.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 10, include: { employee: { select: { id: true, firstName: true, lastName: true } } } }),
    db().hrReview.aggregate({ where: { organizationId, companyId, status: "COMPLETED" }, _avg: { managerRating: true, selfRating: true }, _count: { _all: true } }),
  ]);
  return { goalsByStatus, recentFeedback, avgRatings };
}
