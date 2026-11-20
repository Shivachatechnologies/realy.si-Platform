import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { createTask } from "@/server/modules/agents/service";
import { PROFILE_KEYS, profileByKey } from "@/server/modules/agents/profiles";
import { TRIGGER_EVENTS } from "@/server/modules/automation/definition";
import { WORKFLOW_TEMPLATES } from "@/server/modules/automation/templates";
import { ingestDocument, normalizeTags } from "@/server/modules/brain/service";
import { createPlanItem } from "@/server/modules/finance/analytics";
import { createBudget } from "@/server/modules/finance/transactions";
import { createEntity } from "@/server/modules/graph/service";
import { getConnection } from "@/server/modules/integrations/connections";
import { installGeneratedManifest } from "@/server/modules/marketplace/install";
import { manifestSchema, type Manifest } from "@/server/modules/marketplace/manifest";
import { notifyUsers } from "@/server/modules/notifications/service";
import { createGoal, getStrategy, saveStrategy } from "@/server/modules/objectives/goals";
import { extractJson } from "@/server/modules/objectives/plan";
import { loadTools, getTool } from "@/server/modules/tools/registry";
import { briefText, parseBrief, type RunMode } from "./brief";
import {
  financeSchema,
  goalsSchema,
  nameIdeasSchema,
  productsSchema,
  stepDef,
  stepsFor,
  strategySchema,
  type StepDef,
} from "./steps";
import { importWebsite, WebsiteError } from "./website";

/**
 * Advances builder runs one step at a time: starts the next step's AI task when the previous one is done, converts a
 * completed task's deliverable (Brain document + validated JSON → records), and pauses on decisions that need the
 * founder. Every transition is a conditional update (claim), so the periodic job, the event handler and requests can
 * all call advanceRun concurrently without doing a step twice. Steps act as the founder who started the run, so the
 * founder's permissions apply to everything the builder creates.
 */

export const STEP_SUBJECT = "builder_step";
const TERMINAL = ["COMPLETED", "SKIPPED"] as const;
const RESEARCH_PROVIDERS = ["tavily", "exa", "serpapi"] as const;
const WEB_TOOLS = ["web_research", "web_search", "research_web", "search_web"] as const;

export const listingKeyFor = (runId: string) => `builder/${runId}`;
export const stepTitle = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type RunRow = Prisma.BuilderRunGetPayload<{ include: { company: { select: { name: true; baseCurrency: true } } } }>;
type StepRow = Prisma.BuilderStepGetPayload<object>;

function founderCtx(run: { createdById: string }): RequestContext {
  return userContext(run.createdById, { requestId: `builder_${Date.now().toString(36)}` });
}

const errorReason = (err: unknown) => (isAppError(err) && typeof err.details?.reason === "string" ? err.details.reason : isAppError(err) ? err.code : "internal_error");
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

// ───────────── Instructions ─────────────

async function researchNote(run: RunRow, profileKey: string): Promise<string> {
  const tools = await loadTools();
  const profile = profileByKey(profileKey);
  const tool = WEB_TOOLS.find((t) => tools[t] && getTool(t) && profile?.tools.includes(t));
  if (tool) {
    for (const p of RESEARCH_PROVIDERS) {
      const c = await getConnection(run.organizationId, run.companyId, p).catch(() => null);
      if (c?.status === "CONNECTED") return `Use ${tool} for live web research and cite the sources you used.`;
    }
  }
  return "You have no live web access in this step. Use your general knowledge and the company's documents; state every market figure as an estimate with its assumptions, and list what should be verified with real research.";
}

async function keyFacts(run: RunRow): Promise<string> {
  const done = await db().builderStep.findMany({ where: { runId: run.id, status: "COMPLETED", data: { not: undefined } }, select: { key: true, data: true } });
  const facts: string[] = [];
  for (const s of done) {
    const d = s.data as Record<string, unknown> | null;
    if (!d) continue;
    if (Array.isArray(d.products)) facts.push(`Products: ${(d.products as { name: string }[]).map((p) => p.name).join(", ")}`);
    if (typeof d.mission === "string") facts.push(`Mission: ${d.mission.slice(0, 300)}`);
    if (Array.isArray(d.departments)) facts.push(`Departments: ${(d.departments as { name: string }[]).map((p) => p.name).join(", ")}`);
  }
  return facts.join("\n").slice(0, 1500);
}

function allowedValues(def: StepDef): string {
  const out: string[] = [];
  if (def.key === "ai_employees" || def.effect === "configuration") out.push(`Valid "profile" keys: ${PROFILE_KEYS.join(", ")}.`);
  if (def.key === "operational_workflows" || def.effect === "configuration") {
    out.push(`Workflow "key": prefer a ready-made template (${WORKFLOW_TEMPLATES.map((t) => t.key).join(", ")}); "trigger" must be one of: ${TRIGGER_EVENTS.join(", ")}.`);
  }
  return out.join("\n");
}

async function instructionsFor(run: RunRow, step: StepRow, def: StepDef, index: number, total: number): Promise<string> {
  const brief = parseBrief(run.brief);
  const parts = [
    `You are working on step ${index + 1} of ${total} of the AI Company Builder for this company: "${stepTitle(def.key)}".`,
    `Founder's brief:\n${briefText(brief, run.company.name)}\nCompany base currency: ${run.company.baseCurrency}`,
    `Your task: ${def.prompt}`,
    step.feedback ? `The founder reviewed the previous version and asked for these changes: ${step.feedback}` : "",
    `Earlier deliverables of this builder run are in Company Brain (tag "builder"); search them with search_company_brain first and stay consistent with them.`,
    await keyFacts(run),
    await researchNote(run, def.profile!),
    `Write the deliverable in Markdown with clear headings, concise and specific to this business. Label assumptions as "Assumption:". Never present invented figures, customers or results as facts.`,
  ];
  if (def.schema && def.shape) {
    parts.push(
      `After the Markdown, end your answer with exactly one fenced \`\`\`json block containing ONLY a JSON object of this shape (no comments, no trailing commas): ${def.shape}`,
      allowedValues(def),
      `Do not call tools that create or change records: the builder creates the records from your JSON once it is validated.`,
    );
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 7900);
}

// ───────────── Transitions ─────────────

async function failStep(run: RunRow, step: StepRow, code: string, message: string, issues: string[] = []) {
  await transaction(async (tx) => {
    await tx.builderStep.update({ where: { id: step.id }, data: { status: "FAILED", errorCode: code.slice(0, 80), errorMessage: message.slice(0, 1000), errorIssues: issues.slice(0, 20), completedAt: new Date() } });
    const { count } = await tx.builderRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "FAILED", errorMessage: message.slice(0, 1000) } });
    if (count) await notifyUsers(tx, run.organizationId, [run.createdById], "builder.step_failed", { companyId: run.companyId, title: `${run.company.name}: ${stepTitle(step.key)}`, href: `/builder/${run.id}` });
  });
}

async function startAiStep(run: RunRow, step: StepRow, def: StepDef, index: number, total: number) {
  const { count } = await db().builderStep.updateMany({ where: { id: step.id, status: "PENDING" }, data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), completedAt: null, errorCode: null, errorMessage: null, errorIssues: [] } });
  if (!count) return;
  try {
    const instructions = await instructionsFor(run, step, def, index, total);
    const task = await createTask(founderCtx(run), run.organizationId, run.companyId, {
      profile: def.profile,
      title: `${run.company.name}: ${stepTitle(def.key)}`.slice(0, 200),
      instructions,
      subject: { type: STEP_SUBJECT, id: step.id },
    });
    await db().builderStep.update({ where: { id: step.id }, data: { agentTaskId: task.id } });
  } catch (err) {
    logger.warn({ runId: run.id, step: step.key, err: errorText(err) }, "builder step could not start");
    await failStep(run, step, errorReason(err), errorText(err));
  }
}

async function runSystemStep(run: RunRow, step: StepRow) {
  const { count } = await db().builderStep.updateMany({ where: { id: step.id, status: "PENDING" }, data: { status: "APPLYING", attempts: { increment: 1 }, startedAt: new Date() } });
  if (!count) return false;
  if (step.key === "website_ingest") {
    if (!run.websiteUrl) {
      await db().builderStep.update({ where: { id: step.id }, data: { status: "SKIPPED", completedAt: new Date() } });
      return true;
    }
    try {
      const pages = await importWebsite(founderCtx(run), run, run.websiteUrl);
      await db().builderStep.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), result: { pages } } });
      return true;
    } catch (err) {
      await failStep(run, step, err instanceof WebsiteError ? `builder_website_${err.reason}`.slice(0, 80) : errorReason(err), errorText(err));
      return false;
    }
  }
  await db().builderStep.update({ where: { id: step.id }, data: { status: "SKIPPED", completedAt: new Date() } });
  return true;
}

/** The Markdown part of a deliverable (the JSON block removed). */
function documentPart(output: string, json: string | null) {
  let doc = output.replace(/```json\s*[\s\S]*?```/gi, "");
  if (json && doc.includes(json)) doc = doc.replace(json, "");
  return doc.trim();
}

async function saveDocument(run: RunRow, step: StepRow, def: StepDef, text: string): Promise<string | null> {
  if (text.length < 40) return null;
  const ctx = founderCtx(run);
  const department = await db().department.findFirst({
    where: { organizationId: run.organizationId, companyId: run.companyId, name: { equals: def.department, mode: "insensitive" } },
    select: { id: true },
  });
  try {
    const doc = await ingestDocument(ctx, run.organizationId, run.companyId, {
      title: `${run.company.name} — ${stepTitle(def.key)}`.slice(0, 200),
      filename: `${def.key}.md`,
      content: text,
      departmentId: department?.id ?? null,
      tags: normalizeTags(["builder", def.department, def.key.replace(/_/g, "-")]),
    });
    return doc.id;
  } catch (err) {
    if (isAppError(err) && typeof err.details?.documentId === "string") return err.details.documentId;
    throw err;
  }
}

type Outcome = { status: "done"; result?: Prisma.InputJsonValue } | { status: "waiting" };

function parseJson<T extends z.ZodType>(schema: T, json: string | null): { ok: true; data: z.output<T> } | { ok: false; code: string; issues: string[] } {
  if (!json) return { ok: false, code: "builder_no_json", issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { ok: false, code: "builder_invalid_json", issues: [errorText(err)] };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, code: "builder_invalid_output", issues: r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  return { ok: true, data: r.data };
}

export async function installPart(run: { id: string; organizationId: string; companyId: string; createdById: string; company: { name: string } }, part: Partial<Manifest>, ctx: RequestContext = founderCtx(run)) {
  const manifest = manifestSchema.parse(part);
  const r = await installGeneratedManifest(ctx, run.organizationId, run.companyId, { listingKey: listingKeyFor(run.id), name: `AI Company Builder — ${run.company.name}`, manifest });
  await db().builderRun.update({ where: { id: run.id }, data: { installationId: r.installationId } });
  return r.summary;
}

async function openDecision(run: RunRow, step: StepRow, kind: "NAME" | "STRUCTURE" | "CONFIGURATION", options: unknown) {
  await transaction(async (tx) => {
    const open = await tx.builderDecision.findFirst({ where: { runId: run.id, stepId: step.id, status: "OPEN" }, select: { id: true } });
    if (!open) {
      await tx.builderDecision.create({ data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, stepId: step.id, kind, options: options as Prisma.InputJsonValue } });
    }
    await tx.builderStep.update({ where: { id: step.id }, data: { status: "WAITING_INPUT" } });
    const { count } = await tx.builderRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "WAITING_INPUT" } });
    if (count) await notifyUsers(tx, run.organizationId, [run.createdById], "builder.input_needed", { companyId: run.companyId, title: run.company.name, href: `/builder/${run.id}#decisions` });
  });
}

const addMonthsIso = (months: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, Math.min(d.getUTCDate(), 28))).toISOString().slice(0, 10);
};
const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

async function applyEffect(run: RunRow, step: StepRow, def: StepDef, data: unknown): Promise<Outcome> {
  const ctx = founderCtx(run);
  const { organizationId: org, companyId: co } = run;
  switch (def.effect) {
    case "products": {
      const d = data as z.output<typeof productsSchema>;
      let created = 0;
      let skipped = 0;
      for (const p of d.products) {
        try {
          await createEntity(ctx, org, co, { kind: "PRODUCT", name: p.name, description: [p.description, p.pricing ? `Pricing: ${p.pricing}` : ""].filter(Boolean).join("\n").slice(0, 2000) || undefined });
          created++;
        } catch (err) {
          if (isAppError(err) && err.code === "conflict") skipped++;
          else throw err;
        }
      }
      return { status: "done", result: { products: { created, skipped } } };
    }
    case "strategy": {
      const d = data as z.output<typeof strategySchema>;
      const current = await getStrategy(ctx, org, co);
      if (current.mission || current.vision || current.pillars.length) return { status: "done", result: { strategy: "kept_existing" } };
      await saveStrategy(ctx, org, co, { mission: d.mission, vision: d.vision, values: d.values, pillars: [] });
      return { status: "done", result: { strategy: "saved" } };
    }
    case "name": {
      const d = data as z.output<typeof nameIdeasSchema>;
      if (parseBrief(run.brief).name) return { status: "done", result: { name: "already_chosen" } };
      await openDecision(run, step, "NAME", { nameIdeas: d.nameIdeas, current: run.company.name });
      return { status: "waiting" };
    }
    case "goals": {
      const d = data as z.output<typeof goalsSchema>;
      const existing = new Set((await db().companyGoal.findMany({ where: { organizationId: org, companyId: co }, select: { title: true } })).map((g) => g.title));
      let goals = 0;
      for (const g of d.goals) {
        if (existing.has(g.title)) continue;
        await createGoal(ctx, org, co, { title: g.title, description: g.description ?? null, horizon: g.horizon });
        goals++;
      }
      const summary = await installPart(run, { objectives: d.objectives });
      return { status: "done", result: { goals: { created: goals, skipped: d.goals.length - goals }, ...summary } as unknown as Prisma.InputJsonValue };
    }
    case "structure": {
      await openDecision(run, step, "STRUCTURE", data);
      return { status: "waiting" };
    }
    case "configuration": {
      await openDecision(run, step, "CONFIGURATION", data);
      return { status: "waiting" };
    }
    case "install": {
      const summary = await installPart(run, data as Partial<Manifest>);
      return { status: "done", result: summary as unknown as Prisma.InputJsonValue };
    }
    case "finance": {
      const d = data as z.output<typeof financeSchema>;
      let items = 0;
      let budgets = 0;
      for (const i of d.items) {
        await createPlanItem(ctx, org, co, { name: i.name, date: addMonthsIso(i.monthOffset), amount: money(i.amount), notes: i.notes || undefined });
        items++;
      }
      for (const b of d.budgets) {
        const end = new Date(`${addMonthsIso(b.months)}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() - 1);
        await createBudget(ctx, org, co, { name: b.name, periodStart: addMonthsIso(0), periodEnd: end.toISOString().slice(0, 10), amount: money(b.amount) });
        budgets++;
      }
      return { status: "done", result: { cashPlanItems: items, budgets } };
    }
    default:
      return { status: "done" };
  }
}

async function processCompletedTask(run: RunRow, step: StepRow, def: StepDef, output: string | null) {
  const { count } = await db().builderStep.updateMany({ where: { id: step.id, status: "RUNNING", agentTaskId: step.agentTaskId }, data: { status: "APPLYING" } });
  if (!count) return "busy" as const;
  try {
    if (!output?.trim()) {
      await failStep(run, step, "builder_no_output", "The AI task completed without a deliverable");
      return "failed" as const;
    }
    const json = def.schema ? extractJson(output) : null;
    let parsed: unknown = null;
    if (def.schema) {
      const r = parseJson(def.schema, json);
      if (!r.ok) {
        // Keep the deliverable readable in Brain even when its JSON is unusable.
        const docId = await saveDocument(run, step, def, documentPart(output, json)).catch(() => null);
        if (docId) await db().builderStep.update({ where: { id: step.id }, data: { brainDocumentId: docId } });
        await failStep(run, step, r.code, "The AI's structured output did not pass validation; retry the step to generate it again", r.issues);
        return "failed" as const;
      }
      parsed = r.data;
    }
    const docId = await saveDocument(run, step, def, documentPart(output, json));
    await db().builderStep.update({ where: { id: step.id }, data: { brainDocumentId: docId, data: (parsed ?? undefined) as Prisma.InputJsonValue | undefined } });
    const outcome = await applyEffect(run, step, def, parsed);
    if (outcome.status === "waiting") return "waiting" as const;
    await db().builderStep.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), result: outcome.result ?? undefined } });
    return "done" as const;
  } catch (err) {
    logger.warn({ runId: run.id, step: step.key, err: errorText(err) }, "builder step could not be applied");
    await failStep(run, step, errorReason(err), errorText(err));
    return "failed" as const;
  }
}

async function completeRun(run: RunRow) {
  await transaction(async (tx) => {
    const { count } = await tx.builderRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (count) await notifyUsers(tx, run.organizationId, [run.createdById], "builder.completed", { companyId: run.companyId, title: run.company.name, href: `/builder/${run.id}` });
  });
}

/**
 * Move a run forward as far as it can go right now. `inline` (requests) never runs system steps such as the website
 * import, which take long; the periodic job does those. Returns the number of transitions made.
 */
export async function advanceRun(runId: string, opts: { inline?: boolean } = {}): Promise<number> {
  let transitions = 0;
  for (let guard = 0; guard < 30; guard++) {
    const run = await db().builderRun.findUnique({ where: { id: runId }, include: { company: { select: { name: true, baseCurrency: true } } } });
    if (!run || run.status !== "RUNNING") return transitions;
    const mode = run.mode as RunMode;
    const steps = await db().builderStep.findMany({ where: { runId }, orderBy: { position: "asc" } });
    const index = steps.findIndex((s) => !(TERMINAL as readonly string[]).includes(s.status));
    if (index < 0) {
      await completeRun(run);
      return transitions + 1;
    }
    const step = steps[index]!;
    const def = stepDef(mode, step.key);
    if (!def) {
      await failStep(run, step, "builder_unknown_step", `Unknown step ${step.key}`);
      return transitions + 1;
    }
    if (step.status === "PENDING") {
      if (def.kind === "system") {
        if (opts.inline) return transitions;
        if (!(await runSystemStep(run, step))) return transitions + 1;
        transitions++;
        continue;
      }
      await startAiStep(run, step, def, index, steps.length);
      return transitions + 1;
    }
    if (step.status === "RUNNING") {
      if (!step.agentTaskId) return transitions;
      const task = await db().agentTask.findFirst({ where: { id: step.agentTaskId, companyId: run.companyId }, select: { status: true, output: true, errorCode: true, errorMessage: true } });
      if (!task) {
        await failStep(run, step, "builder_task_missing", "The step's AI task no longer exists");
        return transitions + 1;
      }
      if (task.status === "QUEUED" || task.status === "RUNNING") return transitions;
      if (task.status === "FAILED" || task.status === "CANCELLED") {
        await failStep(run, step, task.errorCode ?? (task.status === "CANCELLED" ? "builder_task_cancelled" : "builder_task_failed"), task.errorMessage ?? (task.status === "CANCELLED" ? "The AI task was cancelled" : "The AI task failed"));
        return transitions + 1;
      }
      const r = await processCompletedTask(run, step, def, task.output);
      if (r !== "done") return transitions + (r === "busy" ? 0 : 1);
      transitions++;
      continue;
    }
    if (step.status === "FAILED") {
      await db().builderRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "FAILED" } });
      return transitions;
    }
    return transitions;
  }
  return transitions;
}

/** Periodic sweep: every active run is advanced (website imports and steps whose tasks finished). */
export async function advanceActiveRuns(): Promise<number> {
  const runs = await db().builderRun.findMany({ where: { status: "RUNNING" }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 50 });
  let n = 0;
  for (const r of runs) {
    try {
      n += await advanceRun(r.id);
    } catch (err) {
      logger.error({ runId: r.id, err: errorText(err) }, "builder run advance failed");
    }
  }
  return n;
}

/** Steps of a new run, in order. */
export function initialSteps(mode: RunMode) {
  return stepsFor(mode).map((s, i) => ({ key: s.key, position: i, profile: s.profile ?? null }));
}

