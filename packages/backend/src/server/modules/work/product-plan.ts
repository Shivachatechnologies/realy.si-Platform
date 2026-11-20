import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductDocKind } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { productOf } from "./product-core";
import { cleanAiDoc, docInstructions, DOC_NAMES, saveDocVersion } from "./product-docs";
import { authorize, blank, isUuid, optText } from "./shared";

/**
 * "Plan with the AI product team": a chain of AI tasks (researcher → business analyst → product manager →
 * architect → UX → UI → QA → release manager). Each step's output is saved as a ProductDoc version and fed to the
 * next step; the periodic job work.product-plans advances the chain when the running task finishes.
 */

export const PLAN_STEPS: { key: string; profile: string; docKind: ProductDocKind }[] = [
  { key: "research", profile: "product_researcher", docKind: "RESEARCH" },
  { key: "business", profile: "business_analyst", docKind: "BRD" },
  { key: "prd", profile: "product_manager", docKind: "PRD" },
  { key: "architecture", profile: "software_architect", docKind: "ARCHITECTURE" },
  { key: "ux", profile: "ux_designer", docKind: "UX_SPEC" },
  { key: "ui", profile: "ui_designer", docKind: "DESIGN_BRIEF" },
  { key: "qa", profile: "qa_agent", docKind: "QA_PLAN" },
  { key: "release", profile: "release_manager", docKind: "RELEASE_PLAN" },
];

export interface PlanStep {
  key: string;
  profile: string;
  docKind: ProductDocKind;
  taskId?: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  docVersion?: number | null;
}

export const planInput = z.object({ brief: optText(2000) });

const log = logger.child({ component: "product-plan" });
const userCtx = (userId: string): RequestContext => ({ ...systemContext(`product_plan_${userId}`), actor: { type: "USER", id: userId } });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function readSteps(v: Prisma.JsonValue): PlanStep[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const def = PLAN_STEPS.find((s) => s.key === o.key);
    if (!def) return [];
    const status = o.status === "RUNNING" || o.status === "DONE" || o.status === "FAILED" ? o.status : "PENDING";
    return [{ ...def, taskId: typeof o.taskId === "string" ? o.taskId : null, status, docVersion: typeof o.docVersion === "number" ? o.docVersion : null }];
  });
}

const json = (steps: PlanStep[]) => steps as unknown as Prisma.InputJsonValue;

/** Earlier steps' outputs, bounded, for the next step's prompt. */
async function previousOutputs(companyId: string, steps: PlanStep[], upTo: number) {
  const done = steps.slice(0, upTo).filter((s) => s.taskId && s.status === "DONE");
  if (!done.length) return "";
  const tasks = await db().agentTask.findMany({ where: { id: { in: done.map((s) => s.taskId!) }, companyId }, select: { id: true, output: true } });
  const budget = Math.floor(2400 / done.length);
  return done.map((s) => `### ${DOC_NAMES[s.docKind]}\n${clip(cleanAiDoc(tasks.find((t) => t.id === s.taskId)?.output ?? ""), budget)}`).join("\n\n");
}

async function startStep(ctx: RequestContext, run: { id: string; organizationId: string; companyId: string; productId: string; brief: string | null }, steps: PlanStep[], index: number) {
  const step = steps[index]!;
  const p = await productOf(db(), run.organizationId, run.companyId, run.productId);
  const previous = await previousOutputs(run.companyId, steps, index);
  const task = await createAgentTask(ctx, run.organizationId, run.companyId, {
    profile: step.profile,
    title: `${DOC_NAMES[step.docKind]}: ${p.name}`.slice(0, 200),
    instructions: await docInstructions(run.organizationId, run.companyId, run.productId, step.docKind, { guidance: run.brief, previous }),
    subject: { type: "product_plan", id: run.id },
  });
  steps[index] = { ...step, taskId: task.id, status: "RUNNING" };
  return task;
}

export async function startPlan(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof planInput>) {
  const input = planInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  await productOf(db(), organizationId, companyId, productId);
  if (await db().productPlanRun.findFirst({ where: { productId, companyId, status: "RUNNING" }, select: { id: true } })) throw conflict("The AI product team is already planning this product", { reason: "work_product_plan_running" });
  const steps: PlanStep[] = PLAN_STEPS.map((s) => ({ ...s, status: "PENDING" }));
  const run = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const r = await tx.productPlanRun.create({ data: { organizationId, companyId, productId, brief: blank(input.brief) ?? null, steps: json(steps), createdById: ctx.actor.id ?? organizationId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product_plan.started", resourceType: "product_plan_run", resourceId: r.id, newValue: { productId } });
    return r;
  });
  try {
    await startStep(ctx, run, steps, 0);
    return db().productPlanRun.update({ where: { id: run.id }, data: { steps: json(steps), currentStep: 0 } });
  } catch (err) {
    // The first task could not be created (AI not configured, budget, permission): the run fails visibly.
    await db().productPlanRun.update({ where: { id: run.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "Failed to start" } });
    throw err;
  }
}

async function runOf(organizationId: string, companyId: string, runId: string) {
  if (!isUuid(runId)) throw notFound("Plan");
  const r = await db().productPlanRun.findFirst({ where: { id: runId, organizationId, companyId } });
  if (!r) throw notFound("Plan");
  return r;
}

export async function cancelPlan(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const r = await runOf(organizationId, companyId, runId);
  if (r.status !== "RUNNING") throw conflict("The plan is not running", { reason: "work_product_plan_not_running" });
  return transaction(async (tx) => {
    const u = await tx.productPlanRun.update({ where: { id: r.id }, data: { status: "CANCELLED", completedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product_plan.cancelled", resourceType: "product_plan_run", resourceId: r.id });
    return u;
  });
}

/** Retry a failed plan from the step that failed. */
export async function retryPlan(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const r = await runOf(organizationId, companyId, runId);
  if (r.status !== "FAILED") throw conflict("Only a failed plan can be retried", { reason: "work_product_plan_not_failed" });
  if (await db().productPlanRun.findFirst({ where: { productId: r.productId, companyId, status: "RUNNING" }, select: { id: true } })) throw conflict("The AI product team is already planning this product", { reason: "work_product_plan_running" });
  const steps = readSteps(r.steps);
  const index = Math.max(0, steps.findIndex((s) => s.status !== "DONE"));
  await startStep(ctx, r, steps, index);
  return db().productPlanRun.update({ where: { id: r.id }, data: { status: "RUNNING", error: null, currentStep: index, steps: json(steps) } });
}

/** Plan runs of a product (newest first) with step task status. */
export async function listPlans(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  await productOf(db(), organizationId, companyId, productId);
  const runs = await db().productPlanRun.findMany({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, take: 10 });
  const taskIds = runs.flatMap((r) => readSteps(r.steps).map((s) => s.taskId)).filter((v): v is string => !!v);
  const tasks = taskIds.length ? await db().agentTask.findMany({ where: { id: { in: taskIds }, companyId }, select: { id: true, status: true, title: true } }) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return runs.map((r) => ({ ...r, steps: readSteps(r.steps).map((s) => ({ ...s, task: s.taskId ? (byId.get(s.taskId) ?? null) : null })) }));
}

/** Advance one running plan; returns true when it changed. */
async function advance(runId: string): Promise<boolean> {
  const run = await db().productPlanRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING") return false;
  const steps = readSteps(run.steps);
  const i = run.currentStep;
  const step = steps[i];
  const ctx = userCtx(run.createdById);
  const fail = async (error: string) => {
    steps[i] = { ...step!, status: "FAILED" };
    await db().productPlanRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error.slice(0, 500), steps: json(steps) } });
    await transaction((tx) => notifyUsers(tx, run.organizationId, [run.createdById], "work.productPlan", { companyId: run.companyId, title: error.slice(0, 120), href: `/product/${run.productId}/plan` }));
    return true;
  };
  if (!step) return fail("Plan step missing");
  if (!step.taskId) {
    try {
      await startStep(ctx, run, steps, i);
      await db().productPlanRun.update({ where: { id: run.id }, data: { steps: json(steps) } });
      return true;
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Could not start the step");
    }
  }
  const task = await db().agentTask.findFirst({ where: { id: step.taskId, companyId: run.companyId }, select: { status: true, output: true, errorMessage: true } });
  if (!task) return fail("The step's AI task is gone");
  if (task.status === "QUEUED" || task.status === "RUNNING") return false;
  if (task.status !== "COMPLETED" || !task.output?.trim()) return fail(task.errorMessage ? `${DOC_NAMES[step.docKind]}: ${task.errorMessage}` : `${DOC_NAMES[step.docKind]}: the AI task did not complete`);
  let docVersion: number | null = null;
  try {
    const saved = await saveDocVersion(ctx, run.organizationId, run.companyId, run.productId, step.docKind, { content: cleanAiDoc(task.output).slice(0, 200_000), changeNote: "AI product team" }, { agentTaskId: step.taskId });
    docVersion = saved.version;
  } catch (err) {
    if (!(isAppError(err) && err.details?.reason === "work_product_doc_unchanged")) return fail(err instanceof Error ? err.message : "Could not save the document");
  }
  steps[i] = { ...step, status: "DONE", docVersion };
  const next = i + 1;
  if (next >= steps.length) {
    await db().productPlanRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), steps: json(steps) } });
    const p = await db().product.findUnique({ where: { id: run.productId }, select: { name: true } });
    await transaction((tx) => notifyUsers(tx, run.organizationId, [run.createdById], "work.productPlanDone", { companyId: run.companyId, title: p?.name ?? "", href: `/product/${run.productId}/plan` }));
    return true;
  }
  try {
    await startStep(ctx, run, steps, next);
    await db().productPlanRun.update({ where: { id: run.id }, data: { currentStep: next, steps: json(steps) } });
  } catch (err) {
    await db().productPlanRun.update({ where: { id: run.id }, data: { currentStep: next, steps: json(steps) } });
    steps[next] = { ...steps[next]!, status: "FAILED" };
    await db().productPlanRun.update({ where: { id: run.id }, data: { status: "FAILED", error: (err instanceof Error ? err.message : "Could not start the next step").slice(0, 500), steps: json(steps) } });
  }
  return true;
}

/** Periodic job: advance every running plan whose current task finished. Idempotent. */
export async function advanceProductPlans() {
  const running = await db().productPlanRun.findMany({ where: { status: "RUNNING" }, select: { id: true }, take: 200, orderBy: { updatedAt: "asc" } });
  let changed = 0;
  for (const r of running) {
    try {
      if (await advance(r.id)) changed++;
    } catch (err) {
      log.error({ runId: r.id, err: err instanceof Error ? err.message : String(err) }, "product plan advance failed");
    }
  }
  return changed;
}

/** "Apply with AI": a business analyst turns the PRD into proposed features and backlog tasks (each approved by a person). */
export async function applyPlanAi(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const p = await productOf(db(), organizationId, companyId, productId);
  const prd = await db().productDoc.findUnique({ where: { productId_kind: { productId, kind: "PRD" } }, select: { id: true } });
  if (!prd) throw conflict("Write or generate the PRD first", { reason: "work_product_no_prd" });
  return createAgentTask(ctx, organizationId, companyId, {
    profile: "business_analyst",
    title: `Features and backlog from the PRD: ${p.name}`.slice(0, 200),
    instructions: [
      `Product id: ${productId} ("${p.name}").`,
      "Read the product (read_product), its documents (read_product_docs: PRD, TECH_REQUIREMENTS, ARCHITECTURE, QA_PLAN) and its current backlog (read_backlog).",
      "For every PRD feature that does not exist yet, propose it with create_feature: title, spec summary, requirements, acceptance criteria and RICE inputs (reach, impact 0.25/0.5/1/2/3, confidence %, effort person-months) where the documents support them.",
      p.developmentProjectId
        ? "Then propose the backlog for the highest-priority features with create_backlog_tasks (concrete engineering tasks with estimates), linked to the feature."
        : "The product has no development project yet: do not create backlog tasks; say so in your summary.",
      "Each proposal is approved by a person; never claim a feature or task exists unless the tool result says so. End with a summary of what you proposed.",
    ].join("\n"),
    subject: { type: "product", id: productId },
  });
}
