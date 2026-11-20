import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { Citation } from "@/server/modules/agents/runtime";
import { createTask, listSubjectTasks } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { ASK_BRAIN_PROFILE } from "./ai-profiles";

/**
 * Ask the Brain: a question becomes an AI task that answers from the company's documents and memory, with
 * citations of the passages it used. Questions asked on /brain/ask use the subject ("brain_question", companyId);
 * an embedded <AskBrain subject=… /> attaches the task to that record instead.
 */

export const BRAIN_QUESTION_SUBJECT = "brain_question";

export const askInput = z.object({
  question: z.string().trim().min(3).max(2000),
  /** Optional context from the embedding page (e.g. "Account Acme GmbH, renewal in Q1"). */
  context: z.string().trim().max(2000).optional(),
  subject: z.object({ type: z.string().regex(/^[a-z_]{2,40}$/), id: z.string().uuid() }).optional(),
});

/** The dedicated profile (search_company_brain + read_company_memory only) once registered, else the research analyst. */
const askProfile = () => (profileByKey(ASK_BRAIN_PROFILE.key) ? ASK_BRAIN_PROFILE.key : "research_analyst");

export async function askBrain(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof askInput>) {
  const input = askInput.parse(raw);
  await requirePermission(ctx, "brain.read", await companyChain(db(), organizationId, companyId));
  const instructions = [
    `Question: ${input.question}`,
    input.context ? `Context from the page the question was asked on:\n${input.context}` : null,
    [
      "Answer the question from the company's own knowledge only.",
      "Use search_company_brain (several searches with different keywords if needed), read_company_memory and search_company_knowledge (records and relationships: customers, deals, projects, people, teams, products) when they are available; do not use other tools.",
      "Cite every statement with the reference of its source, e.g. [S1] for a document passage or [K2] for a record.",
      "Start with a direct answer in one to three sentences, then the supporting details.",
      "If the documents and company memory do not answer the question, say so plainly and do not guess.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  return createTask(ctx, organizationId, companyId, {
    profile: askProfile(),
    title: `Ask the Brain: ${input.question.replace(/\s+/g, " ").slice(0, 170)}`,
    instructions,
    subject: input.subject ?? { type: BRAIN_QUESTION_SUBJECT, id: companyId },
  });
}

/** Recent questions asked on /brain/ask, with their answers and citations (newest first). */
export async function listQuestions(ctx: RequestContext, organizationId: string, companyId: string, take = 20) {
  const tasks = await listSubjectTasks(ctx, organizationId, companyId, BRAIN_QUESTION_SUBJECT, companyId, take);
  const cites = tasks.length
    ? await db().agentTask.findMany({ where: { id: { in: tasks.map((t) => t.id) }, organizationId, companyId }, select: { id: true, citations: true, instructions: true, errorMessage: true } })
    : [];
  const byId = new Map(cites.map((c) => [c.id, c]));
  return tasks.map((t) => {
    const extra = byId.get(t.id);
    const question = extra?.instructions.match(/^Question: ([\s\S]*?)(\n\n|$)/)?.[1] ?? t.title;
    return { ...t, question, citations: ((extra?.citations ?? []) as unknown as Citation[]) ?? [], errorMessage: extra?.errorMessage ?? null };
  });
}
