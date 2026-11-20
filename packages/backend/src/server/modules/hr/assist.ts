import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { createTask } from "@/server/modules/agents/service";
import { employeeName } from "./access";
import { getCandidate, getJob } from "./recruiting";

/**
 * AI HR actions on records: each creates an agent task for an HR AI employee linked to the record (subject), running with
 * the requester's permissions. Writes (scoring a candidate, creating a job posting) go through supervised tools and need a
 * person's approval.
 */
export const CANDIDATE_AI_MODES = ["score", "questions"] as const;
export const candidateAssistInput = z.object({ mode: z.enum(CANDIDATE_AI_MODES), guidance: z.string().trim().max(1000).optional() });
export const jobAssistInput = z.object({ guidance: z.string().trim().max(1000).optional() });
export const analystInput = z.object({ question: z.string().trim().min(1).max(2000) });
export const policyQuestionInput = z.object({ question: z.string().trim().min(1).max(2000) });

const extra = (g?: string) => (g ? `\n\nAdditional direction from the requester: ${g}` : "");

export async function assistCandidate(ctx: RequestContext, organizationId: string, companyId: string, candidateId: string, raw: z.input<typeof candidateAssistInput>) {
  const input = candidateAssistInput.parse(raw);
  const c = await getCandidate(ctx, organizationId, companyId, candidateId);
  const name = employeeName(c);
  const instructions =
    input.mode === "score"
      ? `Call read_candidate with candidateId ${c.id} (it includes the job description and the resume text). Analyze the resume against the job's requirements: summarize relevant experience, strengths, gaps and risks, and give a score from 0 to 100 with a short justification. Then propose writing the result onto the candidate by calling score_candidate with candidateId ${c.id}, the score and a concise summary (max ~120 words). A person must approve it before it is saved. If the candidate has no resume text, say so and score only on the information available, stating that clearly. Do not invent experience.`
      : `Call read_candidate with candidateId ${c.id}. Write a structured interview guide for this candidate and job: 8–12 questions grouped by competency (role skills, experience deep-dives based on their resume, problem solving, collaboration, motivation), what a strong answer looks like for each, and 2–3 follow-up probes on gaps or risks in the resume. Do not call score_candidate.`;
  return createTask(ctx, organizationId, companyId, {
    profile: "recruiter",
    title: `${input.mode === "score" ? "Resume analysis & score" : "Interview questions"}: ${name}`.slice(0, 200),
    instructions: instructions + extra(input.guidance),
    subject: { type: "hr_candidate", id: c.id },
  });
}

export async function assistJob(ctx: RequestContext, organizationId: string, companyId: string, jobId: string, raw: z.input<typeof jobAssistInput>) {
  const input = jobAssistInput.parse(raw);
  const job = await getJob(ctx, organizationId, companyId, jobId);
  const instructions = `Draft a job description for the role "${job.title}"${job.department ? ` in the ${job.department.name} department` : ""}${job.location ? `, location ${job.location}` : ""}, employment type ${job.employmentType}${job.remote ? ", remote-friendly" : ""}. Use search_company_brain for the company's mission, products and culture, and read_open_jobs to stay consistent with other postings. Structure: about the company, the role, responsibilities, requirements, nice-to-haves, what we offer. Inclusive, specific language; no invented benefits or numbers that are not in the company's documents.${job.description ? `\n\nCurrent draft to improve:\n${job.description.slice(0, 4000)}` : ""} This is a draft for a person to paste into the job — do not call create_job_posting.`;
  return createTask(ctx, organizationId, companyId, {
    profile: "recruiter",
    title: `Job description: ${job.title}`.slice(0, 200),
    instructions: instructions + extra(input.guidance),
    subject: { type: "hr_job", id: job.id },
  });
}

export async function askPeopleAnalyst(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof analystInput>) {
  const input = analystInput.parse(raw);
  return createTask(ctx, organizationId, companyId, {
    profile: "people_analyst",
    title: `People insights: ${input.question}`.slice(0, 200),
    subject: { type: "hr_insights", id: companyId },
    instructions: `Call read_headcount_summary and read_open_jobs, then answer this question from the HR team with concrete numbers from the data, the insights you draw, and recommended actions (workforce planning, hiring, retention). Separate facts from your analysis and say when the data does not answer the question.\n\nQuestion: ${input.question}`,
  });
}

export async function askPolicyAssistant(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof policyQuestionInput>) {
  const input = policyQuestionInput.parse(raw);
  return createTask(ctx, organizationId, companyId, {
    profile: "hr_policy_assistant",
    title: `HR policy question: ${input.question}`.slice(0, 200),
    subject: { type: "hr_policy_qa", id: companyId },
    instructions: `Answer this employee question using only the company's HR policies (read_hr_policies) and documents (search_company_brain). Quote or cite the relevant policy; if the policies don't cover it, say so and suggest contacting HR.\n\nQuestion: ${input.question}`,
  });
}
