import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { agentModel, aiRefusal } from "@/server/core/platform-controls";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getConnection } from "@/server/modules/integrations/connections";
import { RESEARCH_PROVIDERS } from "@/server/modules/integrations/services/research";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { notFound } from "@/server/core/errors";
import { parseBrief } from "./brief";
import { starterPlan } from "./blueprint";
import { firstWeekTasks } from "./first-week";
import { BLUEPRINT_KEY, blueprintInput, JOURNEY_RESEARCH_KEYS, WORKFORCE_KEY, workforceInput, type Blueprint, type WorkforcePlan } from "./steps";

/**
 * Everything the journey stages show for a run, read from the database only: research steps with their real AI task
 * state (status, timing, the lookups the AI made) and the saved deliverables, the blueprint and workforce proposals
 * (AI output, the founder's saved edits, or nothing), what the run created, and whether AI and live research are
 * available at all — so the UI can say plainly when they are not.
 */

export type AiAvailability = { ok: true } | { ok: false; reason: string };

export async function aiAvailability(organizationId: string): Promise<AiAvailability> {
  if (!aiConfigured()) return { ok: false, reason: "ai_not_configured" };
  const refusal = await aiRefusal(organizationId, { profile: "research_analyst", model: await agentModel(env().AGENT_MODEL) }).catch(() => null);
  return refusal ? { ok: false, reason: refusal } : { ok: true };
}

/** The first connected research provider (Tavily, Exa, SerpApi), or null. */
export async function researchProvider(organizationId: string, companyId: string): Promise<string | null> {
  for (const p of RESEARCH_PROVIDERS) {
    const c = await getConnection(organizationId, companyId, p).catch(() => null);
    if (c && c.status === "CONNECTED") return p;
  }
  return null;
}

/** The readable part of an AI deliverable: JSON removed, Markdown kept, trimmed to `max` characters. */
export function excerpt(output: string | null, max = 900): string {
  if (!output) return "";
  const doc = output.replace(/```json\s*[\s\S]*?```/gi, "").trim();
  return doc.length > max ? `${doc.slice(0, max).replace(/\s+\S*$/, "")} …` : doc;
}

const toolNames = (raw: unknown): string[] => (Array.isArray(raw) ? raw.flatMap((c) => (c && typeof c === "object" && typeof (c as { tool?: unknown }).tool === "string" ? [(c as { tool: string }).tool] : [])) : []);

export async function journeyView(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await requirePermission(ctx, "companies.read", await companyChain(db(), organizationId, companyId));
  const run = await db().builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true, baseCurrency: true } } } });
  if (!run) throw notFound("Builder run");
  const [steps, decisions, sources] = await Promise.all([
    db().builderStep.findMany({ where: { runId }, orderBy: { position: "asc" } }),
    db().builderDecision.findMany({ where: { runId, status: "OPEN" }, orderBy: { createdAt: "asc" } }),
    db().builderSource.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, take: 80, select: { id: true, kind: true, url: true, title: true, status: true, brainDocumentId: true, errorMessage: true } }),
  ]);
  const taskIds = steps.map((s) => s.agentTaskId).filter((x): x is string => !!x);
  const tasks = await db().agentTask.findMany({
    where: { organizationId, companyId, id: { in: taskIds } },
    select: { id: true, status: true, profile: true, startedAt: true, completedAt: true, createdAt: true, errorMessage: true, output: true, toolCalls: true, citations: true },
  });
  const taskBy = new Map(tasks.map((t) => [t.id, t]));
  const stepView = (s: (typeof steps)[number]) => {
    const t = s.agentTaskId ? taskBy.get(s.agentTaskId) : null;
    const tools = t ? toolNames(t.toolCalls) : [];
    return {
      id: s.id,
      key: s.key,
      status: s.status,
      profile: s.profile,
      attempts: s.attempts,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      errorMessage: s.errorMessage,
      errorIssues: s.errorIssues,
      brainDocumentId: s.brainDocumentId,
      result: s.result as Record<string, unknown> | null,
      task: t
        ? {
            status: t.status,
            profile: t.profile,
            queuedAt: t.createdAt.toISOString(),
            startedAt: t.startedAt?.toISOString() ?? null,
            completedAt: t.completedAt?.toISOString() ?? null,
            errorMessage: t.errorMessage,
            lookups: tools.length,
            lastTool: tools.at(-1) ?? null,
            citations: Array.isArray(t.citations) ? t.citations.length : 0,
            excerpt: t.status === "COMPLETED" ? excerpt(t.output) : "",
          }
        : null,
    };
  };
  const blueprintStep = steps.find((s) => s.key === BLUEPRINT_KEY) ?? null;
  const workforceStep = steps.find((s) => s.key === WORKFORCE_KEY) ?? null;
  const decisionFor = (stepId: string | undefined) => decisions.find((d) => d.stepId === stepId) ?? null;
  const parse = <T,>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, v: unknown): T | null => {
    const r = schema.safeParse(v);
    return r.success ? (r.data as T) : null;
  };
  const bpDecision = decisionFor(blueprintStep?.id);
  const wfDecision = decisionFor(workforceStep?.id);
  const where = { organizationId, companyId };
  const [departments, products, graphProducts, aiEmployees, projects, objectives, goals, workflows, tasksCount] = await Promise.all([
    db().department.count({ where }),
    db().product.count({ where }),
    db().graphEntity.count({ where: { ...where, kind: "PRODUCT" } }),
    db().aiEmployee.findMany({ where: { ...where, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 40, select: { id: true, name: true, profileKey: true, level: true, jobTitle: true, managerEmployeeId: true, status: true, responsibilities: true, goals: true, department: true } }),
    db().project.count({ where }),
    db().objective.count({ where }),
    db().companyGoal.count({ where }),
    db().workflow.count({ where }),
    db().workTask.count({ where }),
  ]);
  // The first real work after hiring (null when the viewer may not see AI tasks).
  const firstWeek = workforceStep?.status === "COMPLETED" ? await firstWeekTasks(ctx, organizationId, companyId, runId).catch(() => null) : [];

  return {
    run: { id: run.id, status: run.status, mode: run.mode, journey: run.journey, errorMessage: run.errorMessage, companyName: run.company.name, brief: parseBrief(run.brief), websiteUrl: run.websiteUrl },
    research: steps.filter((s) => JOURNEY_RESEARCH_KEYS.includes(s.key)).map(stepView),
    blueprint: {
      step: blueprintStep ? stepView(blueprintStep) : null,
      decisionId: bpDecision?.id ?? null,
      /** The AI's proposal (open decision) — null while the AI is still working or when it is not available. */
      proposal: bpDecision ? parse<Blueprint>(blueprintInput, bpDecision.options) : null,
      approved: blueprintStep?.status === "COMPLETED" ? parse<Blueprint>(blueprintInput, blueprintStep.data) : null,
    },
    workforce: {
      step: workforceStep ? stepView(workforceStep) : null,
      decisionId: wfDecision?.id ?? null,
      proposal: wfDecision ? parse<WorkforcePlan>(workforceInput, wfDecision.options) : null,
      starter: starterPlan(),
      approved: workforceStep?.status === "COMPLETED" ? parse<WorkforcePlan>(workforceInput, workforceStep.data) : null,
    },
    later: steps.filter((s) => s.position > (workforceStep?.position ?? Infinity)).map(stepView),
    sources,
    records: { departments, products: Math.max(products, graphProducts), aiEmployees: aiEmployees.length, projects, objectives, goals, workflows, tasks: tasksCount },
    employees: aiEmployees,
    firstWeek: firstWeek?.map((t) => ({ id: t.id, key: t.key, status: t.status, aiEmployeeId: t.aiEmployeeId, profile: t.profile })) ?? null,
  };
}
export type JourneyView = Awaited<ReturnType<typeof journeyView>>;
