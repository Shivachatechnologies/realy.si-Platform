import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, actorId, isUuid, optText, uuid } from "./access";
import { assistCandidate, assistJob } from "./assist";
import { EMPLOYMENT_TYPES } from "./employees";
import { createJob, getJob } from "./recruiting";

/**
 * Guided hiring (/hr/hire). Every step works on the real recruiting records through the existing services (job,
 * AI job description task, publishing, AI screening tasks, interviews, hiring + onboarding); HrHiringJourney only keeps
 * the step reached and the person's plain-language brief so the journey can be resumed.
 */
export const HIRING_STEPS = ["need", "role", "describe", "publish", "candidates", "interviews", "hire"] as const;
export type HiringStep = (typeof HIRING_STEPS)[number];
const STORED_STEPS = ["describe", "publish", "candidates", "interviews", "hire", "done"] as const;

export const startHiringInput = z.object({
  title: z.string().trim().min(2).max(160),
  brief: z.string().trim().min(5).max(3000),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  location: optText(160),
  remote: z.boolean().default(false),
  openings: z.coerce.number().int().min(1).max(50).default(1),
  departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
});
export const hiringStepInput = z.object({ step: z.enum(STORED_STEPS) });

const journeyInclude = { job: { select: { id: true, title: true, status: true, openings: true, publishedAt: true } } } as const;

/** Unfinished hiring journeys (newest first) with candidate counts — "continue where you left off". */
export async function listHiringJourneys(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const rows = await db().hrHiringJourney.findMany({ where: { organizationId, companyId, completedAt: null }, orderBy: { updatedAt: "desc" }, take: 20, include: journeyInclude });
  const counts = rows.length
    ? await db().hrCandidate.groupBy({ by: ["jobId"], where: { companyId, archivedAt: null, jobId: { in: rows.map((r) => r.jobId) } }, _count: { _all: true } })
    : [];
  return rows.map((r) => ({ ...r, candidates: counts.find((c) => c.jobId === r.jobId)?._count._all ?? 0 }));
}

/** Step 2 → creates the job as a draft (createJob) and the journey that remembers the brief. */
export async function startHiring(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof startHiringInput>) {
  const input = startHiringInput.parse(raw);
  const job = await createJob(ctx, organizationId, companyId, {
    title: input.title,
    employmentType: input.employmentType,
    location: input.location,
    remote: input.remote,
    openings: input.openings,
    departmentId: input.departmentId,
    status: "DRAFT",
    description: "",
  });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const j = await tx.hrHiringJourney.create({ data: { organizationId, companyId, jobId: job.id, brief: input.brief, step: "describe", createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.hiring.started", resourceType: "hr_job", resourceId: job.id, newValue: { title: job.title } });
    return { id: j.id, jobId: job.id };
  });
}

async function requireJourney(organizationId: string, companyId: string, jobId: string) {
  if (!isUuid(jobId)) throw notFound("Hiring");
  const j = await db().hrHiringJourney.findFirst({ where: { organizationId, companyId, jobId } });
  if (!j) throw notFound("Hiring");
  return j;
}

/** Everything the journey page needs for one job: job + candidates (getJob), interviews, step and brief. */
export async function getHiringJourney(ctx: RequestContext, organizationId: string, companyId: string, jobId: string) {
  const job = await getJob(ctx, organizationId, companyId, jobId);
  const journey = await db().hrHiringJourney.findFirst({ where: { organizationId, companyId, jobId } });
  const interviews = await db().hrInterview.findMany({
    where: { organizationId, companyId, candidate: { jobId } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
    include: { candidate: { select: { id: true, firstName: true, lastName: true, stage: true } } },
  });
  const hired = job.candidates.filter((c) => c.stage === "HIRED");
  const hiredEmployees = hired.length
    ? await db().hrCandidate.findMany({ where: { id: { in: hired.map((c) => c.id) }, companyId }, select: { id: true, employeeId: true } })
    : [];
  return { job, journey, interviews, hiredEmployees };
}

/** Remember the step reached ("done" closes the journey). Only moves the pointer — never changes records. */
export async function setHiringStep(ctx: RequestContext, organizationId: string, companyId: string, jobId: string, raw: z.input<typeof hiringStepInput>) {
  const { step } = hiringStepInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const j = await requireJourney(organizationId, companyId, jobId);
    await tx.hrHiringJourney.update({ where: { id: j.id }, data: { step, completedAt: step === "done" ? new Date() : null } });
    return { ok: true, step };
  });
}

/** Step 3: the recruiter AI drafts the job description from the brief (a real agent task on the job; nothing is saved
 * until the person edits and saves it). */
export async function draftJobDescription(ctx: RequestContext, organizationId: string, companyId: string, jobId: string) {
  const j = await requireJourney(organizationId, companyId, jobId);
  return assistJob(ctx, organizationId, companyId, jobId, {
    guidance: `What the hiring person told us about the role, in their own words: "${j.brief.slice(0, 900)}". Write in plain, friendly language a non-expert understands. Reply with the finished job description text only.`.slice(0, 1000),
  });
}

/** Step 5: start an AI screening (resume analysis + score, approved by a person) for applicants not scored yet. */
export async function screenApplicants(ctx: RequestContext, organizationId: string, companyId: string, jobId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  await requireJourney(organizationId, companyId, jobId);
  const candidates = await db().hrCandidate.findMany({
    where: { organizationId, companyId, jobId, archivedAt: null, aiScore: null, stage: { in: ["APPLIED", "SCREENING"] } },
    orderBy: { appliedAt: "asc" },
    take: 25,
    select: { id: true },
  });
  const busy = await db().agentTask.findMany({
    where: { organizationId, companyId, subjectType: "hr_candidate", subjectId: { in: candidates.map((c) => c.id) }, status: { in: ["QUEUED", "RUNNING"] } },
    select: { subjectId: true },
  });
  const skip = new Set(busy.map((b) => b.subjectId));
  const todo = candidates.filter((c) => !skip.has(c.id)).slice(0, 10);
  const started: string[] = [];
  for (const c of todo) started.push((await assistCandidate(ctx, organizationId, companyId, c.id, { mode: "score" })).id);
  return { started: started.length, alreadyRunning: skip.size, remaining: Math.max(0, candidates.length - skip.size - todo.length), taskIds: started };
}

/** Screening progress: AI tasks on this job's candidates (status counts). */
export async function screeningStatus(ctx: RequestContext, organizationId: string, companyId: string, candidateIds: string[]) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!candidateIds.length) return { active: 0, completed: 0, failed: 0 };
  const rows = await db().agentTask.groupBy({ by: ["status"], where: { organizationId, companyId, subjectType: "hr_candidate", subjectId: { in: candidateIds } }, _count: { _all: true } });
  const n = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + r._count._all, 0);
  return { active: n("QUEUED") + n("RUNNING"), completed: n("COMPLETED"), failed: n("FAILED") };
}

/** Team health strip: headcount, people on leave today, open roles. */
export async function teamHealth(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const [headcount, onboarding, onLeave, openRoles, applicants] = await Promise.all([
    db().employee.count({ where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" } } }),
    db().employee.count({ where: { organizationId, companyId, archivedAt: null, status: "ONBOARDING" } }),
    db().hrLeaveRequest.count({ where: { organizationId, companyId, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
    db().hrJob.count({ where: { organizationId, companyId, status: "OPEN" } }),
    db().hrCandidate.count({ where: { organizationId, companyId, archivedAt: null, stage: { in: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"] } } }),
  ]);
  return { headcount, onboarding, onLeave, openRoles, applicants };
}

/** Company-wide hiring pipeline (active candidates per stage, plus hired in the last 90 days). */
export async function hiringPipeline(ctx: RequestContext, organizationId: string, companyId: string, jobId?: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await db().hrCandidate.groupBy({
    by: ["stage"],
    where: { organizationId, companyId, archivedAt: null, ...(jobId ? { jobId } : { OR: [{ stage: { not: "HIRED" } }, { hiredAt: { gte: since } }] }) },
    _count: { _all: true },
  });
  const get = (s: string) => rows.find((r) => r.stage === s)?._count._all ?? 0;
  return { APPLIED: get("APPLIED"), SCREENING: get("SCREENING"), INTERVIEW: get("INTERVIEW"), OFFER: get("OFFER"), HIRED: get("HIRED"), REJECTED: get("REJECTED") };
}
