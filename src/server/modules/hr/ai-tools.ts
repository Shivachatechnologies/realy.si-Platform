import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { dayString, employeeName } from "./access";
import { listPolicies } from "./policies";
import { createJob, getCandidate, listOpenJobs, recordAiScore } from "./recruiting";
import { headcountSummary } from "./summary";
import { EMPLOYMENT_TYPES } from "./employees";

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
};
