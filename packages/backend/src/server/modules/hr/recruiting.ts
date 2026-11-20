import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { HrCandidateStage, HrJobStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { extractPdfText } from "@/server/modules/brain/pdf";
import { actorId, authorize, day, employeeName, enumParam, isUuid, money, myEmployee, oneParam, optText, pageParam, patchText, requireEmployees, toDay, toMinor, uuid } from "./access";
import { createEmployee, EMPLOYMENT_TYPES } from "./employees";
import { pushInterviewToCalendar } from "./interview-calendar";

/** Recruiting (ATS): jobs, candidates and their pipeline, resumes, notes, interviews, scorecards, offers and hiring. */

export const JOB_STATUSES = ["DRAFT", "OPEN", "CLOSED"] as const;
export const CANDIDATE_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
export const PIPELINE_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"] as const;
export const INTERVIEW_TYPES = ["PHONE", "VIDEO", "ONSITE", "TECHNICAL", "PANEL"] as const;
export const INTERVIEW_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export const RECOMMENDATIONS = ["STRONG_NO", "NO", "YES", "STRONG_YES"] as const;
export const OFFER_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;
export const CANDIDATE_SOURCES = ["careers", "referral", "manual", "agency", "linkedin", "other"] as const;
export const SCORECARD_CRITERIA = ["skills", "experience", "communication", "problemSolving", "cultureAdd"] as const;
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const CANDIDATE_PAGE_SIZE = 50;

const emptyU = z.literal("").transform(() => undefined);
const emptyN = z.literal("").transform(() => null);
const nil = (v?: string | null) => (v ? v : null);

export const jobInput = z.object({
  title: z.string().trim().min(1).max(160),
  departmentId: uuid.optional().or(emptyU),
  location: optText(160),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  remote: z.boolean().default(false),
  description: z.string().trim().max(20_000).default(""),
  status: z.enum(JOB_STATUSES).default("DRAFT"),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  salaryMin: money.optional().or(emptyU),
  salaryMax: money.optional().or(emptyU),
  hiringManagerId: uuid.optional().or(emptyU),
});
export const jobPatch = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  departmentId: uuid.nullable().optional().or(emptyN),
  location: patchText(160),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  remote: z.boolean().optional(),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  openings: z.coerce.number().int().min(1).max(500).optional(),
  salaryMin: money.nullable().optional().or(emptyN),
  salaryMax: money.nullable().optional().or(emptyN),
  hiringManagerId: uuid.nullable().optional().or(emptyN),
});
export const resumeInput = z.object({
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 8),
});
export const candidateInput = z.object({
  jobId: uuid,
  firstName: z.string().trim().min(1).max(100),
  lastName: optText(100),
  email: z.string().trim().email().max(254),
  phone: optText(40),
  linkedinUrl: z.string().trim().url().max(300).optional().or(emptyU),
  coverLetter: optText(10_000),
  source: z.enum(CANDIDATE_SOURCES).default("manual"),
  resume: resumeInput.optional(),
});
export const candidatePatch = z.object({
  stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"]).optional(),
  rating: z.literal("").transform(() => null).or(z.coerce.number().int().min(1).max(5)).nullable().optional(),
  rejectedReason: patchText(1000),
  decisionNote: patchText(2000),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: patchText(100),
  email: z.string().trim().email().max(254).optional(),
  phone: patchText(40),
  linkedinUrl: z.string().trim().url().max(300).nullable().optional().or(emptyN),
  jobId: uuid.optional(),
});
export const noteInput = z.object({ body: z.string().trim().min(1).max(5000) });
export const interviewInput = z.object({
  scheduledAt: z.string().datetime({ offset: true, local: true }),
  durationMin: z.coerce.number().int().min(5).max(600).default(45),
  type: z.enum(INTERVIEW_TYPES).default("VIDEO"),
  location: optText(300),
  interviewerIds: z.array(uuid).max(10).default([]),
  notes: optText(2000),
});
export const interviewPatch = z.object({
  status: z.enum(INTERVIEW_STATUSES).optional(),
  scheduledAt: z.string().datetime({ offset: true, local: true }).optional(),
  location: patchText(300),
  notes: patchText(2000),
});
export const scorecardInput = z.object({
  interviewId: uuid.optional().or(emptyU),
  ratings: z.record(z.string().max(40), z.coerce.number().int().min(1).max(5)).default({}),
  recommendation: z.enum(RECOMMENDATIONS),
  comments: optText(5000),
});
export const offerInput = z.object({
  title: z.string().trim().min(1).max(160),
  salary: money,
  startDate: day.optional().or(emptyU),
  terms: optText(10_000),
});
export const offerPatch = z.object({
  status: z.enum(OFFER_STATUSES).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  salary: money.optional(),
  startDate: day.nullable().optional().or(emptyN),
  terms: patchText(10_000),
});
export const hireInput = z.object({
  title: optText(120),
  departmentId: uuid.optional().or(emptyU),
  teamId: uuid.optional().or(emptyU),
  managerId: uuid.optional().or(emptyU),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  startDate: day.optional().or(emptyU),
  note: optText(2000),
});
export const aiScoreInput = z.object({ score: z.number().int().min(0).max(100), summary: z.string().trim().min(1).max(4000) });

const candidateListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  stage: true,
  rating: true,
  aiScore: true,
  source: true,
  appliedAt: true,
  resumeFilename: true,
  job: { select: { id: true, title: true } },
} satisfies Prisma.HrCandidateSelect;

// ─── Jobs ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function salaryRange(min: bigint | null, max: bigint | null) {
  if (min != null && max != null && min > max) throw invalid("Minimum salary is above maximum", { reason: "hr_salary_range" });
}

export async function listJobs(ctx: RequestContext, organizationId: string, companyId: string, filters: { q?: string; status?: HrJobStatus } = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const jobs = await db().hrJob.findMany({
    where: { organizationId, companyId, ...(filters.status ? { status: filters.status } : {}), ...(filters.q ? { title: { contains: filters.q, mode: "insensitive" } } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
    include: { department: { select: { id: true, name: true } }, hiringManager: { select: { id: true, firstName: true, lastName: true } } },
  });
  const counts = await db().hrCandidate.groupBy({ by: ["jobId", "stage"], where: { companyId, organizationId, archivedAt: null, jobId: { in: jobs.map((j) => j.id) } }, _count: { _all: true } });
  return jobs.map((j) => {
    const mine = counts.filter((c) => c.jobId === j.id);
    return { ...j, candidates: mine.reduce((n, c) => n + c._count._all, 0), active: mine.filter((c) => c.stage !== "HIRED" && c.stage !== "REJECTED").reduce((n, c) => n + c._count._all, 0), hired: mine.find((c) => c.stage === "HIRED")?._count._all ?? 0 };
  });
}

/** Open jobs (directory-level information: anyone with hr.read; also public on the careers page). */
export async function listOpenJobs(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().hrJob.findMany({
    where: { organizationId, companyId, status: "OPEN" },
    orderBy: { publishedAt: "desc" },
    take: 200,
    include: { department: { select: { name: true } } },
  });
}

async function requireJob(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Job");
  const j = await client.hrJob.findFirst({ where: { id, organizationId, companyId } });
  if (!j) throw notFound("Job");
  return j;
}

export async function getJob(ctx: RequestContext, organizationId: string, companyId: string, jobId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(jobId)) throw notFound("Job");
  const job = await db().hrJob.findFirst({
    where: { id: jobId, organizationId, companyId },
    include: { department: { select: { id: true, name: true } }, hiringManager: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!job) throw notFound("Job");
  const candidates = await db().hrCandidate.findMany({ where: { jobId, companyId, archivedAt: null }, orderBy: [{ aiScore: { sort: "desc", nulls: "last" } }, { appliedAt: "desc" }], take: 1000, select: candidateListSelect });
  return { ...job, candidates };
}

export async function createJob(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof jobInput>) {
  const input = jobInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, companyId, organizationId, archivedAt: null } }))) throw notFound("Department");
    if (input.hiringManagerId) await requireEmployees(tx, organizationId, companyId, [input.hiringManagerId]);
    const salaryMinMinor = toMinor(input.salaryMin, company.baseCurrency);
    const salaryMaxMinor = toMinor(input.salaryMax, company.baseCurrency);
    salaryRange(salaryMinMinor, salaryMaxMinor);
    const job = await tx.hrJob.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        departmentId: nil(input.departmentId),
        location: nil(input.location),
        employmentType: input.employmentType,
        remote: input.remote,
        description: input.description,
        status: input.status,
        openings: input.openings,
        salaryMinMinor,
        salaryMaxMinor,
        currency: company.baseCurrency,
        hiringManagerId: nil(input.hiringManagerId),
        publishedAt: input.status === "OPEN" ? new Date() : null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.job.created", resourceType: "hr_job", resourceId: job.id, newValue: { title: job.title, status: job.status } });
    return job;
  });
}

export async function updateJob(ctx: RequestContext, organizationId: string, companyId: string, jobId: string, raw: z.input<typeof jobPatch>) {
  const input = jobPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireJob(tx, organizationId, companyId, jobId);
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, companyId, organizationId, archivedAt: null } }))) throw notFound("Department");
    if (input.hiringManagerId) await requireEmployees(tx, organizationId, companyId, [input.hiringManagerId]);
    const salaryMinMinor = input.salaryMin === undefined ? before.salaryMinMinor : toMinor(input.salaryMin, before.currency);
    const salaryMaxMinor = input.salaryMax === undefined ? before.salaryMaxMinor : toMinor(input.salaryMax, before.currency);
    salaryRange(salaryMinMinor, salaryMaxMinor);
    const status = input.status ?? before.status;
    const job = await tx.hrJob.update({
      where: { id: jobId },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.location !== undefined ? { location: nil(input.location) } : {}),
        ...(input.employmentType ? { employmentType: input.employmentType } : {}),
        ...(input.remote !== undefined ? { remote: input.remote } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.openings ? { openings: input.openings } : {}),
        ...(input.hiringManagerId !== undefined ? { hiringManagerId: input.hiringManagerId } : {}),
        salaryMinMinor,
        salaryMaxMinor,
        status,
        ...(status === "OPEN" && before.status !== "OPEN" ? { publishedAt: new Date(), closedAt: null } : {}),
        ...(status === "CLOSED" && before.status !== "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: before.status !== status ? "hr.job.status_changed" : "hr.job.updated", resourceType: "hr_job", resourceId: jobId, oldValue: { status: before.status }, newValue: { ...input, salaryMin: undefined, salaryMax: undefined } });
    return job;
  });
}

// ─── Candidates ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CandidateFilters {
  q?: string;
  job?: string;
  stage?: HrCandidateStage | "ACTIVE";
  sort: "applied" | "score" | "name" | "rating";
  page: number;
}

export function parseCandidateFilters(raw: Record<string, string | string[] | undefined>): CandidateFilters {
  const job = oneParam(raw, "job");
  const stage = oneParam(raw, "stage");
  return {
    q: oneParam(raw, "q"),
    job: isUuid(job) ? job : undefined,
    stage: stage === "ACTIVE" ? "ACTIVE" : enumParam(raw, "stage", CANDIDATE_STAGES),
    sort: enumParam(raw, "sort", ["applied", "score", "name", "rating"] as const) ?? "applied",
    page: pageParam(raw),
  };
}

export async function listCandidates(ctx: RequestContext, organizationId: string, companyId: string, f: Partial<CandidateFilters> = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const where: Prisma.HrCandidateWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.job) where.jobId = f.job;
  if (f.stage === "ACTIVE") where.stage = { in: [...PIPELINE_STAGES] };
  else if (f.stage) where.stage = f.stage;
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    where.OR = [{ firstName: contains }, { lastName: contains }, { email: contains }, { resumeText: contains }];
  }
  const orderBy: Prisma.HrCandidateOrderByWithRelationInput[] =
    f.sort === "score"
      ? [{ aiScore: { sort: "desc", nulls: "last" } }, { appliedAt: "desc" }]
      : f.sort === "rating"
        ? [{ rating: { sort: "desc", nulls: "last" } }, { appliedAt: "desc" }]
        : f.sort === "name"
          ? [{ firstName: "asc" }, { lastName: "asc" }]
          : [{ appliedAt: "desc" }];
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    db().hrCandidate.findMany({ where, orderBy, skip: (page - 1) * CANDIDATE_PAGE_SIZE, take: CANDIDATE_PAGE_SIZE, select: candidateListSelect }),
    db().hrCandidate.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / CANDIDATE_PAGE_SIZE)) };
}

async function requireCandidate(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Candidate");
  const c = await client.hrCandidate.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, omit: { resumeBytes: true } });
  if (!c) throw notFound("Candidate");
  return c;
}

export async function getCandidate(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(candidateId)) throw notFound("Candidate");
  const c = await db().hrCandidate.findFirst({
    where: { id: candidateId, organizationId, companyId },
    omit: { resumeBytes: true },
    include: {
      job: { select: { id: true, title: true, status: true, currency: true, departmentId: true, employmentType: true, hiringManagerId: true, description: true, location: true } },
      notes: { orderBy: { createdAt: "desc" } },
      interviews: { orderBy: { scheduledAt: "asc" } },
      scorecards: { orderBy: { createdAt: "desc" } },
      offers: { orderBy: { createdAt: "desc" } },
      employee: { select: { id: true, firstName: true, lastName: true, status: true } },
    },
  });
  if (!c) throw notFound("Candidate");
  const interviewerIds = [...new Set(c.interviews.flatMap((i) => i.interviewerIds))];
  const userIds = [...new Set([...c.notes.map((n) => n.authorId), ...c.scorecards.map((s) => s.authorId)].filter((v): v is string => !!v))];
  const [interviewers, users] = await Promise.all([
    interviewerIds.length ? db().employee.findMany({ where: { id: { in: interviewerIds }, companyId }, select: { id: true, firstName: true, lastName: true } }) : [],
    userIds.length ? db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  return { ...c, interviewerNames: new Map(interviewers.map((e) => [e.id, employeeName(e)])), userNames: new Map(users.map((u) => [u.id, u.name])) };
}

/** Validate, size-check and read a PDF resume; text extraction failures keep the file but no text. */
export async function readResume(input: z.infer<typeof resumeInput>) {
  if (!input.filename.toLowerCase().endsWith(".pdf")) throw invalid("The resume must be a PDF", { reason: "hr_resume_pdf" });
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length) throw invalid("The file is empty");
  if (bytes.length > MAX_RESUME_BYTES) throw invalid("The resume exceeds 5 MB", { reason: "hr_file_too_large" });
  if (bytes.subarray(0, 1024).indexOf("%PDF-") === -1) throw invalid("The file is not a valid PDF", { reason: "hr_resume_pdf" });
  let text: string | null = null;
  try {
    text = (await extractPdfText(new Uint8Array(bytes))).slice(0, 100_000);
  } catch {
    text = null;
  }
  return { filename: input.filename.slice(0, 200), bytes, text };
}

/** Insert a candidate (manual or from the careers page), emit candidate.applied and notify HR. */
export async function insertCandidate(
  tx: Tx,
  ctx: RequestContext,
  job: { id: string; organizationId: string; companyId: string; title: string },
  input: Omit<z.infer<typeof candidateInput>, "resume" | "jobId">,
  resume: Awaited<ReturnType<typeof readResume>> | null,
) {
  const dupe = await tx.hrCandidate.findFirst({ where: { jobId: job.id, companyId: job.companyId, email: { equals: input.email, mode: "insensitive" }, archivedAt: null }, select: { id: true } });
  if (dupe) throw conflict("This person already applied for this job", { reason: "hr_candidate_duplicate", candidateId: dupe.id });
  const c = await tx.hrCandidate.create({
    data: {
      organizationId: job.organizationId,
      companyId: job.companyId,
      jobId: job.id,
      firstName: input.firstName,
      lastName: nil(input.lastName),
      email: input.email.toLowerCase(),
      phone: nil(input.phone),
      linkedinUrl: nil(input.linkedinUrl),
      coverLetter: nil(input.coverLetter),
      source: input.source,
      resumeFilename: resume?.filename ?? null,
      resumeBytes: resume ? new Uint8Array(resume.bytes) : null,
      resumeSize: resume?.bytes.length ?? null,
      resumeText: resume?.text ?? null,
    },
    select: { id: true, firstName: true, lastName: true, email: true, source: true },
  });
  const name = employeeName(c);
  await emitDomainEvent(tx, ctx, "candidate.applied", {
    organizationId: job.organizationId,
    companyId: job.companyId,
    entityType: "hr_candidate",
    entityId: c.id,
    data: { name, email: c.email, jobId: job.id, jobTitle: job.title, source: c.source, hasResume: !!resume },
  });
  const recipients = await usersWithPermission(tx, job.organizationId, job.companyId, "hr.manage");
  await notifyUsers(tx, job.organizationId, recipients.filter((u) => u !== ctx.actor.id), "hr.candidate_applied", {
    companyId: job.companyId,
    title: `${name} — ${job.title}`,
    href: `/hr/recruiting/candidates/${c.id}`,
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId: job.organizationId, action: "hr.candidate.created", resourceType: "hr_candidate", resourceId: c.id, newValue: { jobId: job.id, source: c.source } });
  return c;
}

export async function createCandidate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof candidateInput>) {
  const input = candidateInput.parse(raw);
  const resume = input.resume ? await readResume(input.resume) : null;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const job = await requireJob(tx, organizationId, companyId, input.jobId);
    return insertCandidate(tx, ctx, job, input, resume);
  });
}

export async function updateCandidate(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof candidatePatch>) {
  const input = candidatePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireCandidate(tx, organizationId, companyId, candidateId);
    if (before.stage === "HIRED" && input.stage) throw invalid("This candidate was hired", { reason: "hr_candidate_hired" });
    if (input.jobId) await requireJob(tx, organizationId, companyId, input.jobId);
    const c = await tx.hrCandidate.update({
      where: { id: candidateId },
      data: {
        ...(input.stage ? { stage: input.stage } : {}),
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.rejectedReason !== undefined ? { rejectedReason: nil(input.rejectedReason) } : {}),
        ...(input.decisionNote !== undefined ? { decisionNote: nil(input.decisionNote) } : {}),
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: nil(input.lastName) } : {}),
        ...(input.email ? { email: input.email.toLowerCase() } : {}),
        ...(input.phone !== undefined ? { phone: nil(input.phone) } : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
      },
      select: { id: true, stage: true },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: input.stage && input.stage !== before.stage ? "hr.candidate.stage_changed" : "hr.candidate.updated",
      resourceType: "hr_candidate",
      resourceId: candidateId,
      oldValue: { stage: before.stage },
      newValue: input,
    });
    return c;
  });
}

export async function archiveCandidate(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireCandidate(tx, organizationId, companyId, candidateId);
    await tx.hrCandidate.update({ where: { id: candidateId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.candidate.archived", resourceType: "hr_candidate", resourceId: candidateId });
    return { ok: true };
  });
}

export async function uploadResume(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof resumeInput>) {
  const resume = await readResume(resumeInput.parse(raw));
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireCandidate(tx, organizationId, companyId, candidateId);
    await tx.hrCandidate.update({ where: { id: candidateId }, data: { resumeFilename: resume.filename, resumeBytes: new Uint8Array(resume.bytes), resumeSize: resume.bytes.length, resumeText: resume.text } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.candidate.resume_uploaded", resourceType: "hr_candidate", resourceId: candidateId, newValue: { filename: resume.filename, size: resume.bytes.length, text: !!resume.text } });
    return { ok: true, hasText: !!resume.text };
  });
}

export async function getResumeFile(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(candidateId)) throw notFound("Resume");
  const c = await db().hrCandidate.findFirst({ where: { id: candidateId, organizationId, companyId }, select: { resumeBytes: true, resumeFilename: true } });
  if (!c?.resumeBytes) throw notFound("Resume");
  return { bytes: c.resumeBytes, filename: c.resumeFilename ?? "resume.pdf" };
}

export async function addCandidateNote(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof noteInput>) {
  const input = noteInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireCandidate(tx, organizationId, companyId, candidateId);
    const n = await tx.hrCandidateNote.create({ data: { organizationId, companyId, candidateId, body: input.body, authorId: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.candidate.note_added", resourceType: "hr_candidate", resourceId: candidateId });
    return n;
  });
}

const toInstant = (v: string) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  return d;
};

export async function scheduleInterview(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof interviewInput>) {
  const input = interviewInput.parse(raw);
  const created = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const c = await requireCandidate(tx, organizationId, companyId, candidateId);
    if (c.stage === "HIRED" || c.stage === "REJECTED") throw invalid("This candidate is no longer in the pipeline", { reason: "hr_candidate_closed" });
    await requireEmployees(tx, organizationId, companyId, input.interviewerIds);
    const scheduledAt = toInstant(input.scheduledAt);
    const iv = await tx.hrInterview.create({
      data: { organizationId, companyId, candidateId, type: input.type, scheduledAt, durationMin: input.durationMin, location: nil(input.location), interviewerIds: [...new Set(input.interviewerIds)], notes: nil(input.notes), createdById: actorId(ctx, organizationId) },
    });
    if (c.stage === "APPLIED" || c.stage === "SCREENING") await tx.hrCandidate.update({ where: { id: candidateId }, data: { stage: "INTERVIEW" } });
    const users = await tx.employee.findMany({ where: { id: { in: input.interviewerIds }, companyId }, select: { userId: true } });
    await notifyUsers(tx, organizationId, users.map((u) => u.userId).filter((u) => u !== ctx.actor.id), "hr.interview_scheduled", {
      companyId,
      title: employeeName(c),
      href: `/hr/recruiting/candidates/${candidateId}`,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.interview.scheduled", resourceType: "hr_interview", resourceId: iv.id, newValue: { candidateId, scheduledAt, type: input.type } });
    return iv;
  });
  // Outside the transaction: the interview is saved even if the calendar provider is down.
  const calendar = await pushInterviewToCalendar(organizationId, companyId, created.id);
  return { ...created, calendar };
}

export async function updateInterview(ctx: RequestContext, organizationId: string, companyId: string, interviewId: string, raw: z.input<typeof interviewPatch>) {
  const input = interviewPatch.parse(raw);
  const updated = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(interviewId)) throw notFound("Interview");
    const iv = await tx.hrInterview.findFirst({ where: { id: interviewId, organizationId, companyId } });
    if (!iv) throw notFound("Interview");
    const updated = await tx.hrInterview.update({
      where: { id: interviewId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.scheduledAt ? { scheduledAt: toInstant(input.scheduledAt) } : {}),
        ...(input.location !== undefined ? { location: nil(input.location) } : {}),
        ...(input.notes !== undefined ? { notes: nil(input.notes) } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.interview.updated", resourceType: "hr_interview", resourceId: interviewId, oldValue: { status: iv.status }, newValue: input });
    return updated;
  });
  const calendar = updated.status === "SCHEDULED" && (input.scheduledAt || input.location !== undefined || input.status) ? await pushInterviewToCalendar(organizationId, companyId, updated.id) : null;
  return { ...updated, calendar };
}

/** Interviews the viewer is on (as an employee), upcoming first — for the self-service page. */
export async function myInterviews(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (!me) return [];
  return db().hrInterview.findMany({
    where: { organizationId, companyId, interviewerIds: { has: me.id }, status: "SCHEDULED", scheduledAt: { gte: new Date(Date.now() - 86_400_000) } },
    orderBy: { scheduledAt: "asc" },
    take: 20,
    include: { candidate: { select: { id: true, firstName: true, lastName: true, job: { select: { title: true } } } } },
  });
}

/** Scorecard by HR or by one of the interview's interviewers. */
export async function addScorecard(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof scorecardInput>) {
  const input = scorecardInput.parse(raw);
  return transaction(async (tx) => {
    const c = await tx.hrCandidate.findFirst({ where: { id: isUuid(candidateId) ? candidateId : undefined, organizationId, companyId, archivedAt: null }, select: { id: true } });
    if (!c) throw notFound("Candidate");
    let interview: { id: string; interviewerIds: string[] } | null = null;
    if (input.interviewId) {
      interview = await tx.hrInterview.findFirst({ where: { id: input.interviewId, candidateId, companyId }, select: { id: true, interviewerIds: true } });
      if (!interview) throw notFound("Interview");
    }
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    if (interview && me && interview.interviewerIds.includes(me.id)) await authorize(ctx, organizationId, companyId, "hr.read", tx);
    else await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const unknown = Object.keys(input.ratings).filter((k) => !(SCORECARD_CRITERIA as readonly string[]).includes(k));
    if (unknown.length) throw invalid("Unknown criterion");
    const sc = await tx.hrScorecard.create({
      data: { organizationId, companyId, candidateId, interviewId: interview?.id ?? null, ratings: input.ratings, recommendation: input.recommendation, comments: nil(input.comments), authorId: ctx.actor.id },
    });
    if (interview) await tx.hrInterview.updateMany({ where: { id: interview.id, status: "SCHEDULED", scheduledAt: { lte: new Date() } }, data: { status: "COMPLETED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.scorecard.submitted", resourceType: "hr_candidate", resourceId: candidateId, newValue: { recommendation: input.recommendation, interviewId: interview?.id } });
    return sc;
  });
}

/** For interviewers without hr.manage: the minimal candidate view needed to fill a scorecard. */
export async function interviewForScorecard(ctx: RequestContext, organizationId: string, companyId: string, interviewId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  if (!isUuid(interviewId)) throw notFound("Interview");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const iv = await db().hrInterview.findFirst({
    where: { id: interviewId, organizationId, companyId },
    include: { candidate: { select: { id: true, firstName: true, lastName: true, job: { select: { title: true } } } } },
  });
  if (!iv) throw notFound("Interview");
  if (!me || !iv.interviewerIds.includes(me.id)) throw forbidden("You are not an interviewer on this interview");
  return iv;
}

// ─── Offers & hiring ────────────────────────────────────────────────────────────────────────────────────────────────

export async function createOffer(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof offerInput>) {
  const input = offerInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const c = await requireCandidate(tx, organizationId, companyId, candidateId);
    if (c.stage === "HIRED" || c.stage === "REJECTED") throw invalid("This candidate is no longer in the pipeline", { reason: "hr_candidate_closed" });
    const job = await tx.hrJob.findFirstOrThrow({ where: { id: c.jobId }, select: { currency: true } });
    const offer = await tx.hrOffer.create({
      data: { organizationId, companyId, candidateId, title: input.title, salaryMinor: toMinor(input.salary, job.currency)!, currency: job.currency, startDate: toDay(input.startDate), terms: nil(input.terms), createdById: actorId(ctx, organizationId) },
    });
    if (c.stage !== "OFFER") await tx.hrCandidate.update({ where: { id: candidateId }, data: { stage: "OFFER" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.offer.created", resourceType: "hr_offer", resourceId: offer.id, newValue: { candidateId, title: input.title } });
    return offer;
  });
}

export async function updateOffer(ctx: RequestContext, organizationId: string, companyId: string, offerId: string, raw: z.input<typeof offerPatch>) {
  const input = offerPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(offerId)) throw notFound("Offer");
    const o = await tx.hrOffer.findFirst({ where: { id: offerId, organizationId, companyId } });
    if (!o) throw notFound("Offer");
    if ((o.status === "ACCEPTED" || o.status === "DECLINED") && (input.salary || input.title || input.terms !== undefined)) throw invalid("This offer is closed", { reason: "hr_offer_closed" });
    const status = input.status ?? o.status;
    const updated = await tx.hrOffer.update({
      where: { id: offerId },
      data: {
        status,
        ...(input.title ? { title: input.title } : {}),
        ...(input.salary ? { salaryMinor: toMinor(input.salary, o.currency)! } : {}),
        ...(input.startDate !== undefined ? { startDate: toDay(input.startDate) } : {}),
        ...(input.terms !== undefined ? { terms: nil(input.terms) } : {}),
        ...(status === "SENT" && o.status !== "SENT" ? { sentAt: new Date() } : {}),
        ...((status === "ACCEPTED" || status === "DECLINED") && status !== o.status ? { respondedAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: status !== o.status ? "hr.offer.status_changed" : "hr.offer.updated", resourceType: "hr_offer", resourceId: offerId, oldValue: { status: o.status }, newValue: { status } });
    return updated;
  });
}

/** Offer with candidate, job and company for the printable letter. */
export async function getOfferLetter(ctx: RequestContext, organizationId: string, companyId: string, offerId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(offerId)) throw notFound("Offer");
  const o = await db().hrOffer.findFirst({
    where: { id: offerId, organizationId, companyId },
    include: { candidate: { select: { id: true, firstName: true, lastName: true, email: true, job: { select: { title: true, location: true, employmentType: true, department: { select: { name: true } } } } } }, company: { select: { name: true, legalName: true } } },
  });
  if (!o) throw notFound("Offer");
  return o;
}

/**
 * Hiring decision: creates the Employee (status ONBOARDING) from the candidate and accepted offer, starts onboarding,
 * marks the candidate HIRED, closes the job when all openings are filled, and emits candidate.hired.
 */
export async function hireCandidate(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof hireInput>) {
  const input = hireInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const c = await requireCandidate(tx, organizationId, companyId, candidateId);
    if (c.stage === "HIRED") throw conflict("This candidate was already hired", { reason: "hr_candidate_hired" });
    const job = await tx.hrJob.findFirstOrThrow({ where: { id: c.jobId } });
    const offer = await tx.hrOffer.findFirst({ where: { candidateId, companyId, status: { in: ["ACCEPTED", "SENT", "DRAFT"] } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
    const startDate = input.startDate ?? (offer?.startDate ? offer.startDate.toISOString().slice(0, 10) : undefined);
    const e = await createEmployee(
      ctx,
      organizationId,
      companyId,
      {
        firstName: c.firstName,
        lastName: c.lastName ?? undefined,
        email: c.email,
        phone: c.phone ?? undefined,
        title: input.title || offer?.title || job.title,
        departmentId: input.departmentId ?? job.departmentId ?? undefined,
        teamId: input.teamId,
        managerId: input.managerId ?? job.hiringManagerId ?? undefined,
        employmentType: input.employmentType ?? job.employmentType,
        status: "ONBOARDING",
        startDate,
        location: job.location ?? undefined,
        startOnboarding: true,
      },
      { tx },
    );
    if (offer && offer.status !== "ACCEPTED") await tx.hrOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    if (offer) {
      await tx.hrCompensation.create({
        data: {
          organizationId,
          companyId,
          employeeId: e.id,
          baseMonthlyMinor: offer.salaryMinor / 12n,
          currency: offer.currency,
          effectiveFrom: offer.startDate ?? new Date(new Date().toISOString().slice(0, 10)),
          note: "From accepted offer",
          createdById: actorId(ctx, organizationId),
        },
      });
    }
    const hiredAt = new Date();
    await tx.hrCandidate.update({ where: { id: candidateId }, data: { stage: "HIRED", hiredAt, employeeId: e.id, decisionNote: nil(input.note) ?? c.decisionNote } });
    const hired = await tx.hrCandidate.count({ where: { jobId: job.id, companyId, stage: "HIRED" } });
    if (hired >= job.openings && job.status === "OPEN") await tx.hrJob.update({ where: { id: job.id }, data: { status: "CLOSED", closedAt: hiredAt } });
    await emitDomainEvent(tx, ctx, "candidate.hired", {
      organizationId,
      companyId,
      entityType: "hr_candidate",
      entityId: candidateId,
      data: { name: employeeName(c), email: c.email, jobId: job.id, jobTitle: job.title, employeeId: e.id, startDate: e.startDate, daysToHire: Math.max(0, Math.round((hiredAt.getTime() - c.appliedAt.getTime()) / 86_400_000)) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.candidate.hired", resourceType: "hr_candidate", resourceId: candidateId, newValue: { employeeId: e.id, jobId: job.id } });
    return { employeeId: e.id };
  });
}

/** Writes the AI assessment (approved score_candidate tool call). */
export async function recordAiScore(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof aiScoreInput>) {
  const input = aiScoreInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireCandidate(tx, organizationId, companyId, candidateId);
    await tx.hrCandidate.update({ where: { id: candidateId }, data: { aiScore: input.score, aiSummary: input.summary, aiScoredAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.candidate.ai_scored", resourceType: "hr_candidate", resourceId: candidateId, newValue: { score: input.score } });
    return { ok: true };
  });
}

/** Upcoming interviews for the recruiting overview. */
export async function upcomingInterviews(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  return db().hrInterview.findMany({
    where: { organizationId, companyId, status: "SCHEDULED", scheduledAt: { gte: new Date(Date.now() - 3_600_000) } },
    orderBy: { scheduledAt: "asc" },
    take: 20,
    include: { candidate: { select: { id: true, firstName: true, lastName: true, job: { select: { title: true } } } } },
  });
}

/** JSON-friendly candidate for the API (name maps as plain objects). */
export async function getCandidateApi(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string) {
  const { interviewerNames, userNames, ...c } = await getCandidate(ctx, organizationId, companyId, candidateId);
  return { ...c, interviewerNames: Object.fromEntries(interviewerNames), userNames: Object.fromEntries(userNames) };
}
