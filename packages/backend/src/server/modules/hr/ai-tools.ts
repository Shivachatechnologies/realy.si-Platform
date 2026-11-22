import { z } from "zod";
import { AppError } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { dayString, employeeName } from "./access";
import { listPolicies } from "./policies";
import { CANDIDATE_STAGES, createJob, getCandidate, INTERVIEW_TYPES, listCandidates, listOpenJobs, recordAiScore, scheduleInterview, updateCandidate } from "./recruiting";
import { headcountSummary } from "./summary";
import { EMPLOYMENT_TYPES } from "./employees";
import { createHeadcountPlan, PLAN_PRIORITIES, quarterKey, workforcePlan } from "./planning";
import { applyOnboardingPlan, employeeRecordForAi, onboardingPlanInput, teamOverview } from "./manager";
import { CHECKLIST_CATEGORIES, OWNER_ROLES } from "./onboarding";

/** AI tools of the hr module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */

const empty = { type: "object", properties: {}, required: [], additionalProperties: false } as const;

export const HR_TOOLS: Record<string, ToolDefinition> = {
  read_open_jobs: def({
    name: "read_open_jobs",
    version: 1,
    description: "Returns the company's open job postings (id, title, department, location, employment type, openings, description excerpt).",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read open jobs",
    async execute(_i, { ctx, organizationId, companyId }) {
      const jobs = await listOpenJobs(ctx, organizationId, companyId);
      if (!jobs.length) return { content: "The company has no open jobs.", count: 0 };
      const content = jobs
        .map((j) => `- Job ${j.id}: ${j.title}${j.department ? ` (${j.department.name})` : ""}, ${j.employmentType}${j.location ? `, ${j.location}` : ""}${j.remote ? ", remote" : ""}, ${j.openings} opening(s)\n  ${j.description.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n");
      return { content, count: jobs.length, records: jobs.map((j) => `hr_job:${j.id}`) };
    },
  }),

  read_candidate: def({
    name: "read_candidate",
    version: 1,
    description: "Returns one candidate: contact-free profile, stage, the job (title and description), resume text, cover letter, screening notes, interviews and scorecards.",
    input: z.object({ candidateId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { candidateId: { type: "string", description: "Candidate id" } }, required: ["candidateId"], additionalProperties: false },
    permissions: ["hr.manage"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a candidate's application and resume",
    async execute({ candidateId }, { ctx, organizationId, companyId }) {
      const c = await getCandidate(ctx, organizationId, companyId, candidateId);
      const job = c.job;
      const content = [
        `Candidate ${c.id}: ${employeeName(c)} — stage ${c.stage}, source ${c.source}, applied ${dayString(c.appliedAt)}${c.aiScore != null ? `, previous AI score ${c.aiScore}` : ""}${c.rating ? `, recruiter rating ${c.rating}/5` : ""}`,
        `Job: ${job.title}${job.location ? ` (${job.location})` : ""}\n${job.description.slice(0, 6000) || "(no description)"}`,
        `Resume text:\n${c.resumeText ? c.resumeText.slice(0, 30_000) : "(no resume text available)"}`,
        c.coverLetter ? `Cover letter:\n${c.coverLetter.slice(0, 5000)}` : null,
        c.notes.length ? `Screening notes:\n${c.notes.map((n) => `- ${dayString(n.createdAt)}: ${n.body}`).join("\n")}` : null,
        c.interviews.length ? `Interviews:\n${c.interviews.map((i) => `- ${i.type} ${i.status} ${i.scheduledAt.toISOString()}`).join("\n")}` : null,
        c.scorecards.length ? `Scorecards:\n${c.scorecards.map((s) => `- ${s.recommendation} ${JSON.stringify(s.ratings)}${s.comments ? `: ${s.comments}` : ""}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      return { content, records: [`hr_candidate:${c.id}`] };
    },
  }),

  read_hr_policies: def({
    name: "read_hr_policies",
    version: 1,
    description: "Returns the company's published HR policies (title, category, version and full text).",
    input: z.object({ query: z.string().trim().max(100).optional() }).strict(),
    modelSchema: { type: "object", properties: { query: { type: "string", description: "Optional keyword to filter policies by title or text" } }, required: [], additionalProperties: false },
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query }) => (query ? `Read HR policies about "${query}"` : "Read HR policies"),
    async execute({ query }, { ctx, organizationId, companyId }) {
      const q = query?.toLowerCase();
      const policies = (await listPolicies(ctx, organizationId, companyId)).filter((p) => p.publishedAt && (!q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)));
      if (!policies.length) return { content: q ? `No published HR policy mentions "${query}".` : "The company has no published HR policies.", count: 0 };
      let budget = 40_000;
      const parts: string[] = [];
      for (const p of policies) {
        const text = p.body.slice(0, Math.max(0, budget));
        budget -= text.length;
        parts.push(`## ${p.title} (${p.category}, v${p.version})\n${text}`);
        if (budget <= 0) break;
      }
      return { content: parts.join("\n\n"), count: policies.length, records: policies.map((p) => `hr_policy:${p.id}`) };
    },
  }),

  read_headcount_summary: def({
    name: "read_headcount_summary",
    version: 1,
    description: "Returns aggregated workforce numbers: headcount by status, employment type and department, new hires, leavers and attrition, tenure, span of control, open positions, active candidates and leave. No salaries or personal data.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the headcount summary",
    async execute(_i, { ctx, organizationId, companyId }) {
      const s = await headcountSummary(ctx, organizationId, companyId);
      return { content: JSON.stringify(s, null, 2), count: s.headcount };
    },
  }),

  score_candidate: def({
    name: "score_candidate",
    version: 1,
    description: "Propose saving an AI assessment on a candidate: a 0–100 score and a short summary of strengths, gaps and fit. A person must approve it before it is saved.",
    input: z.object({ candidateId: z.string().uuid(), score: z.number().int().min(0).max(100), summary: z.string().trim().min(1).max(4000) }).strict(),
    modelSchema: {
      type: "object",
      properties: { candidateId: { type: "string" }, score: { type: "integer", description: "0–100" }, summary: { type: "string", description: "Strengths, gaps and fit in a few sentences" } },
      required: ["candidateId", "score", "summary"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ score }) => `Save AI score ${score}/100 on a candidate`,
    async execute({ candidateId, score, summary }, { ctx, organizationId, companyId }) {
      await recordAiScore(ctx, organizationId, companyId, candidateId, { score, summary });
      return { content: `Saved score ${score}/100 on the candidate.`, records: [`hr_candidate:${candidateId}`] };
    },
  }),

  create_job_posting: def({
    name: "create_job_posting",
    version: 1,
    description: "Propose creating a job posting (saved as a draft that HR publishes). A person must approve it before it is created.",
    input: z
      .object({
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().min(1).max(20_000),
        location: z.string().trim().max(160).optional(),
        employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
        remote: z.boolean().optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", description: "Full job description (plain text or Markdown)" },
        location: { type: "string" },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES] },
        remote: { type: "boolean" },
      },
      required: ["title", "description"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title }) => `Create draft job posting "${title}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const job = await createJob(ctx, organizationId, companyId, { ...input, status: "DRAFT" });
      return { content: `Created draft job posting "${job.title}" (${job.id}). HR can review and publish it.`, records: [`hr_job:${job.id}`] };
    },
  }),

  read_workforce_plan: def({
    name: "read_workforce_plan",
    version: 1,
    description: "Returns the company's workforce plan: today's headcount per department and every planned role (title, department, quarter, headcount, priority, status, reason). Costs are totals only, never individual salaries.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the workforce plan",
    async execute(_i, { ctx, organizationId, companyId }) {
      const plan = await workforcePlan(ctx, organizationId, companyId);
      const depts = plan.departments.map((d) => `- ${d.name ?? "No department"}: ${d.current} today, +${d.planned} planned`).join("\n");
      const roles = plan.plans.map((p) => `- ${p.headcount} × ${p.title} (${p.departmentName ?? "no department"}, ${quarterKey(p.targetStart)}, ${p.priority}, ${p.status})${p.reason ? `: ${p.reason.slice(0, 200)}` : ""}`).join("\n");
      return {
        content: `Headcount today: ${plan.totals.currentHeadcount}. Planned people: ${plan.totals.plannedPeople}. Planned yearly cost (all roles, minor units of ${plan.currency}): ${plan.totals.plannedAnnualCost}.\n\nBy department:\n${depts || "(none)"}\n\nPlanned roles:\n${roles || "(none)"}`,
        count: plan.plans.length,
      };
    },
  }),

  propose_planned_role: def({
    name: "propose_planned_role",
    version: 1,
    description: "Adds a role to the workforce plan as PLANNED (a person approves it before hiring starts). Use for roles you recommend; give a short reason.",
    input: z
      .object({
        title: z.string().trim().min(2).max(160),
        headcount: z.number().int().min(1).max(50).default(1),
        targetStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
        priority: z.enum(PLAN_PRIORITIES).optional(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        headcount: { type: "integer", minimum: 1, maximum: 50 },
        targetStart: { type: "string", description: "Approximate start date YYYY-MM-DD (saved as the start of that quarter)" },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES] },
        priority: { type: "string", enum: [...PLAN_PRIORITIES] },
        reason: { type: "string", description: "Why the company needs this role, from the data" },
      },
      required: ["title", "targetStart", "reason"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title, headcount }) => `Add ${headcount ?? 1} × "${title}" to the workforce plan`,
    async execute(input, { ctx, organizationId, companyId }) {
      const plan = await createHeadcountPlan(ctx, organizationId, companyId, input);
      return { content: `Added "${plan.title}" (${plan.headcount}) to the workforce plan for ${quarterKey(plan.targetStart)} as PLANNED. A person approves it before hiring.`, records: [`hr_headcount_plan:${plan.id}`] };
    },
  }),
  read_employee_record: def({
    name: "read_employee_record",
    version: 1,
    description: "Returns one employee's work record for HR tasks: title, department, start date, onboarding checklist steps, goals, KPIs, feedback, development plans and past reviews. No salary or personal contact data.",
    input: z.object({ employeeId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { employeeId: { type: "string" } }, required: ["employeeId"], additionalProperties: false },
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read an employee's work record",
    async execute({ employeeId }, { ctx, organizationId, companyId }) {
      return { content: await employeeRecordForAi(ctx, organizationId, companyId, employeeId), records: [`employee:${employeeId}`] };
    },
  }),

  read_team_overview: def({
    name: "read_team_overview",
    version: 1,
    description: "Per-department team snapshot: headcount, people on leave today, onboarding in progress and running late, goals at risk, reviews pending in active cycles, open roles, and the largest manager span.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["hr.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the team overview",
    async execute(_i, { ctx, organizationId, companyId }) {
      const o = await teamOverview(ctx, organizationId, companyId);
      const lines = o.departments.map(
        (d) => `- ${d.name ?? "No department"}: ${d.headcount} people, ${d.onLeave} on leave today, ${d.onboarding} onboarding (${d.onboardingLate} late), ${d.goalsAtRisk} goal(s) at risk, ${d.reviewsPending} review(s) pending, ${d.openRoles} open role(s)`,
      );
      return { content: `Headcount ${o.headcount}. Largest team per manager: ${o.largestTeam}; managers with more than 8 reports: ${o.managersOver8}.\n${lines.join("\n")}`, count: lines.length };
    },
  }),

  propose_onboarding_plan: def({
    name: "propose_onboarding_plan",
    version: 1,
    description: "Propose adding onboarding steps to an employee's onboarding checklist (opened if needed). Each step becomes a tracked task for its owner. A person must approve the plan first; steps already on the checklist are skipped.",
    input: onboardingPlanInput.strict(),
    modelSchema: {
      type: "object",
      properties: {
        employeeId: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              category: { type: "string", enum: [...CHECKLIST_CATEGORIES] },
              ownerRole: { type: "string", enum: [...OWNER_ROLES] },
              dueDate: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["employeeId", "steps"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ steps }) => `Add ${steps.length} onboarding step(s) to the checklist`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await applyOnboardingPlan(ctx, organizationId, companyId, input);
      return { content: `Added ${r.added} step(s) to the onboarding checklist ${r.checklistId}.`, records: [`hr_checklist:${r.checklistId}`] };
    },
  }),

  read_candidates: def({
    name: "read_candidates",
    version: 1,
    description: "Lists candidates in the hiring pipeline (newest first, up to 50): id, name, job, stage, AI score, recruiter rating, source and application date. Filter by job and/or stage (ACTIVE = applied, screening, interview or offer).",
    input: z.object({ jobId: z.string().uuid().optional(), stage: z.enum([...CANDIDATE_STAGES, "ACTIVE"]).optional(), sort: z.enum(["applied", "score", "rating"]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Only candidates for this job" },
        stage: { type: "string", enum: [...CANDIDATE_STAGES, "ACTIVE"], description: "Pipeline stage; ACTIVE = still in the pipeline" },
        sort: { type: "string", enum: ["applied", "score", "rating"] },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    actionClass: "read",
    summarize: ({ stage }) => `Read candidates${stage ? ` (${stage})` : ""}`,
    async execute({ jobId, stage, sort }, { ctx, organizationId, companyId }) {
      const r = await listCandidates(ctx, organizationId, companyId, { job: jobId, stage, sort: sort ?? "applied", page: 1 });
      if (!r.rows.length) return { content: "No candidates match.", count: 0 };
      const content = r.rows
        .map((c) => `- Candidate ${c.id}: ${employeeName(c)} — ${c.job.title} (job ${c.job.id}), stage ${c.stage}${c.aiScore != null ? `, AI score ${c.aiScore}` : ""}${c.rating ? `, rating ${c.rating}/5` : ""}, source ${c.source}, applied ${dayString(c.appliedAt)}`)
        .join("\n");
      return { content: `${r.total} candidate(s); showing ${r.rows.length}.\n${content}`, count: r.rows.length, records: r.rows.map((c) => `hr_candidate:${c.id}`) };
    },
  }),

  move_candidate_stage: def({
    name: "move_candidate_stage",
    version: 1,
    description: "Propose moving a candidate to another pipeline stage (APPLIED, SCREENING, INTERVIEW, OFFER or REJECTED, with a reason when rejecting). Hiring is done by a person. A person must approve the move first.",
    input: z
      .object({
        candidateId: z.string().uuid(),
        stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"]),
        reason: z.string().trim().min(1).max(1000).optional(),
      })
      .strict()
      .refine((v) => v.stage !== "REJECTED" || !!v.reason, { message: "Give a job-related reason when rejecting", path: ["reason"] }),
    modelSchema: {
      type: "object",
      properties: {
        candidateId: { type: "string" },
        stage: { type: "string", enum: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"] },
        reason: { type: "string", description: "Job-related reason (required when rejecting)" },
      },
      required: ["candidateId", "stage"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ stage }) => `Move a candidate to ${stage}`,
    async execute({ candidateId, stage, reason }, { ctx, organizationId, companyId }) {
      const c = await updateCandidate(ctx, organizationId, companyId, candidateId, { stage, ...(stage === "REJECTED" ? { rejectedReason: reason } : reason ? { decisionNote: reason } : {}) });
      return { content: `The candidate is now in stage ${c.stage}.`, records: [`hr_candidate:${candidateId}`] };
    },
  }),

  schedule_interview: def({
    name: "schedule_interview",
    version: 1,
    description:
      "Propose scheduling an interview with a candidate: date and time (ISO 8601 with offset), duration, type, location or link, interviewer employee ids (default: the job's hiring manager) and notes. On approval the interview is saved, the interviewers are notified and, when a Google or Outlook calendar is connected, the event is created there (otherwise HR can download an .ics file).",
    input: z
      .object({
        candidateId: z.string().uuid(),
        scheduledAt: z.string().datetime({ offset: true }),
        durationMin: z.number().int().min(5).max(600).optional(),
        type: z.enum(INTERVIEW_TYPES).optional(),
        location: z.string().trim().max(300).optional(),
        interviewerIds: z.array(z.string().uuid()).max(10).optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        candidateId: { type: "string" },
        scheduledAt: { type: "string", description: "Start, ISO 8601 with time-zone offset, e.g. 2026-12-01T10:00:00+01:00" },
        durationMin: { type: "integer", description: "Minutes (default 45)" },
        type: { type: "string", enum: [...INTERVIEW_TYPES] },
        location: { type: "string", description: "Room, address or video link" },
        interviewerIds: { type: "array", items: { type: "string" }, description: "Employee ids of the interviewers" },
        notes: { type: "string" },
      },
      required: ["candidateId", "scheduledAt"],
      additionalProperties: false,
    },
    permissions: ["hr.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    // The calendar provider emails the invitation to the candidate and interviewers.
    channel: "email",
    summarize: ({ scheduledAt, type }) => `Schedule a${type ? ` ${type.toLowerCase()}` : "n"} interview on ${scheduledAt}`,
    async execute(input, { ctx, organizationId, companyId }) {
      if (new Date(input.scheduledAt).getTime() < Date.now()) throw new AppError("validation_error", "The interview time is in the past");
      // Without named interviewers the job's hiring manager interviews (when the job has one).
      const interviewerIds = input.interviewerIds?.length ? input.interviewerIds : [(await getCandidate(ctx, organizationId, companyId, input.candidateId)).job.hiringManagerId].filter((v): v is string => !!v);
      const iv = await scheduleInterview(ctx, organizationId, companyId, input.candidateId, { ...input, interviewerIds });
      const cal = iv.calendar.synced ? `It was added to the connected ${iv.calendar.provider === "google_calendar" ? "Google" : "Outlook"} calendar.` : iv.calendar.provider ? `The calendar event could not be created${iv.calendar.error ? ` (${iv.calendar.error})` : ""}; HR can retry from the interview page.` : "No calendar is connected; HR can download an .ics file from the candidate page.";
      return { content: `Interview ${iv.id} scheduled for ${iv.scheduledAt.toISOString()}. ${cal}`, records: [`hr_interview:${iv.id}`, `hr_candidate:${input.candidateId}`] };
    },
  }),
};
