import { z } from "zod";
import { db, Prisma, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { cancelTask } from "@/server/modules/agents/service";
import { writeAudit } from "@/server/modules/audit/service";
import { createCompany, createCompanyInput } from "@/server/modules/companies/service";
import type { Manifest } from "@/server/modules/marketplace/manifest";
import { slugify } from "@/server/modules/organizations/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { briefSchema, parseBrief, RUN_MODES, type RunMode } from "./brief";
import { advanceRun, initialSteps, installPart } from "./engine";
import { startKit } from "./kit";
import type { configurationSchema, structureSchema } from "./steps";
import { assertFeature } from "@/server/modules/entitlements/service";

/**
 * AI Company Builder: runs (one active per company), their decisions and the onboarding entry point that creates a
 * company and starts its run. Reads need companies.read, everything else companies.manage at the company.
 */

const ACTIVE = ["DRAFT", "RUNNING", "WAITING_INPUT", "FAILED"] as const;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "companies.read" | "companies.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

export const createRunInput = z.object({
  mode: z.enum(RUN_MODES).default("NEW_IDEA"),
  brief: briefSchema,
  /** The 6-stage onboarding journey's step list (research → blueprint → workforce → post-launch). */
  journey: z.boolean().default(false),
  /** Keep the run as a draft (documents are uploaded first, then it is started). */
  hold: z.boolean().default(false),
  /** Also generate the Founder Kit (builder/kit.ts) for this run. */
  kit: z.boolean().default(false),
});

function checkBrief(mode: RunMode, brief: z.output<typeof briefSchema>) {
  if (mode === "NEW_IDEA" && brief.idea.length < 10) throw invalid("Describe the business idea in a sentence or two", { reason: "builder_idea_required", issues: [{ path: "brief.idea", message: "Describe the idea" }] });
}

async function runIn(tx: Tx | Db, organizationId: string, companyId: string, runId: string) {
  if (!isUuid(runId)) throw notFound("Builder run");
  const run = await tx.builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true } } } });
  if (!run) throw notFound("Builder run");
  return run;
}

/** Start a builder run for a company. New-idea runs start right away; existing-business runs start as drafts so sources can be added first. */
export async function createRun(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createRunInput>) {
  const input = createRunInput.parse(raw);
  checkBrief(input.mode, input.brief);
  if (input.kit) await assertFeature(ctx, organizationId, "feature.company_builder_advanced");
  const run = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    const active = await tx.builderRun.findFirst({ where: { organizationId, companyId, status: { in: [...ACTIVE] } }, select: { id: true } });
    if (active) throw conflict("This company already has a builder run in progress", { reason: "builder_run_active", runId: active.id });
    const starts = !input.hold && (input.journey || input.mode === "NEW_IDEA");
    const r = await tx.builderRun.create({
      data: {
        organizationId,
        companyId,
        mode: input.mode,
        status: starts ? "RUNNING" : "DRAFT",
        brief: input.brief as Prisma.InputJsonValue,
        websiteUrl: input.brief.websiteUrl ?? null,
        startedAt: starts ? new Date() : null,
        journey: input.journey,
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await tx.builderStep.createMany({ data: initialSteps(input.mode, input.journey).map((s) => ({ ...s, organizationId, companyId, runId: r.id })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "builder.run.created", resourceType: "builder_run", resourceId: r.id, newValue: { companyId, mode: r.mode, journey: r.journey } });
    return r;
  });
  if (run.status === "RUNNING") await advanceRun(run.id, { inline: true });
  if (input.kit) await startKit(ctx, organizationId, companyId, run.id);
  return { id: run.id, status: run.status, companyId };
}

/** Existing business: start the analysis once sources are in. */
export async function startRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    await runIn(tx, organizationId, companyId, runId);
    const { count } = await tx.builderRun.updateMany({ where: { id: runId, status: "DRAFT" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (!count) throw conflict("Only a draft run can be started", { reason: "builder_not_draft" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "builder.run.started", resourceType: "builder_run", resourceId: runId });
  });
  return { ok: true };
}

export async function cancelRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  const running = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    const run = await runIn(tx, organizationId, companyId, runId);
    if (!(ACTIVE as readonly string[]).includes(run.status)) throw conflict("This run is not active", { reason: "builder_not_active" });
    await tx.builderRun.update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date() } });
    const steps = await tx.builderStep.findMany({ where: { runId, status: { in: ["PENDING", "RUNNING", "WAITING_INPUT", "FAILED"] } }, select: { id: true, status: true, agentTaskId: true } });
    await tx.builderStep.updateMany({ where: { id: { in: steps.map((s) => s.id) } }, data: { status: "CANCELLED" } });
    await tx.builderDecision.updateMany({ where: { runId, status: "OPEN" }, data: { status: "DECIDED", choice: { action: "cancelled" }, decidedById: ctx.actor.id, decidedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "builder.run.cancelled", resourceType: "builder_run", resourceId: runId, oldValue: { status: run.status } });
    return steps.filter((s) => s.status === "RUNNING" && s.agentTaskId).map((s) => s.agentTaskId!);
  });
  for (const taskId of running) await cancelTask(ctx, organizationId, companyId, taskId).catch(() => undefined);
  return { ok: true };
}

export const retryInput = z.object({ feedback: z.string().trim().max(2000).optional() });

/** Re-run a failed step (optionally with founder feedback); the run continues from there. */
export async function retryStep(ctx: RequestContext, organizationId: string, companyId: string, runId: string, stepId: string, raw: z.input<typeof retryInput> = {}) {
  const input = retryInput.parse(raw);
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    const run = await runIn(tx, organizationId, companyId, runId);
    if (!isUuid(stepId)) throw notFound("Step");
    const { count } = await tx.builderStep.updateMany({
      where: { id: stepId, runId, status: "FAILED" },
      data: { status: "PENDING", agentTaskId: null, errorCode: null, errorMessage: null, errorIssues: [], feedback: input.feedback ?? undefined },
    });
    if (!count) throw conflict("Only a failed step can be retried", { reason: "builder_step_not_failed" });
    await tx.builderRun.updateMany({ where: { id: runId, status: { in: ["FAILED", "RUNNING"] } }, data: { status: "RUNNING", errorMessage: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "builder.step.retried", resourceType: "builder_step", resourceId: stepId, newValue: { runId: run.id } });
  });
  await advanceRun(runId, { inline: true });
  return { ok: true };
}

/** Advance on request (the workspace polls this while a run is active); the periodic job does the same. */
export async function nudgeRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "companies.read");
  await runIn(db(), organizationId, companyId, runId);
  return { transitions: await advanceRun(runId, { inline: true }) };
}

// ───────────── Decisions ─────────────

export const decideInput = z.object({
  action: z.enum(["approve", "revise"]),
  value: z.string().trim().min(1).max(120).optional(),
  feedback: z.string().trim().max(2000).optional(),
  /** Names of proposed records to leave out (departments, AI employees, projects, workflows, pipelines). */
  exclude: z.array(z.string().max(200)).max(200).default([]),
});

async function renameCompany(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, name: string) {
  const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true, slug: true } });
  if (company.name === name) return;
  const slug = slugify(name);
  const taken = await tx.company.findFirst({ where: { organizationId, slug, NOT: { id: companyId } }, select: { id: true } });
  if (taken) throw conflict("Another company in this organization already uses this name", { reason: "builder_name_taken" });
  await tx.company.update({ where: { id: companyId }, data: { name, slug } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company.renamed", resourceType: "company", resourceId: companyId, oldValue: { name: company.name }, newValue: { name }, reason: "AI Company Builder name decision" });
}

/** Founder Kit "use this name": rename the company and remember the choice on the run's brief. */
export async function chooseCompanyName(ctx: RequestContext, organizationId: string, companyId: string, runId: string, name: string) {
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    const run = await runIn(tx, organizationId, companyId, runId);
    await renameCompany(tx, ctx, organizationId, companyId, name);
    await tx.builderRun.update({ where: { id: runId }, data: { brief: { ...parseBrief(run.brief), name } as Prisma.InputJsonValue } });
  });
}

const keep = <T extends { name: string }>(items: T[] | undefined, exclude: Set<string>) => (items ?? []).filter((i) => !exclude.has(i.name));

export async function decide(ctx: RequestContext, organizationId: string, companyId: string, runId: string, decisionId: string, raw: z.input<typeof decideInput>) {
  const input = decideInput.parse(raw);
  if (!isUuid(decisionId)) throw notFound("Decision");
  const { run, decision } = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "companies.manage", tx);
    const run = await runIn(tx, organizationId, companyId, runId);
    const decision = await tx.builderDecision.findFirst({ where: { id: decisionId, runId, status: "OPEN" } });
    if (!decision) throw notFound("Decision");
    if (run.status !== "WAITING_INPUT" && run.status !== "RUNNING") throw conflict("This run is not active", { reason: "builder_not_active" });
    return { run, decision };
  });
  const exclude = new Set(input.exclude);
  let result: Prisma.InputJsonValue = {};

  if (input.action === "approve" && (decision.kind === "BLUEPRINT" || decision.kind === "WORKFORCE")) {
    throw conflict("Review and approve this in the onboarding journey editor", { reason: "builder_use_journey_editor" });
  }
  if (input.action === "revise") {
    if (!input.feedback) throw invalid("Tell the AI what to change", { reason: "builder_feedback_required", issues: [{ path: "feedback", message: "Required" }] });
  } else if (decision.kind === "NAME") {
    if (!input.value) throw invalid("Choose or enter a name", { reason: "builder_name_required", issues: [{ path: "value", message: "Required" }] });
    await transaction(async (tx) => {
      await renameCompany(tx, ctx, organizationId, companyId, input.value!);
      const brief = parseBrief(run.brief);
      await tx.builderRun.update({ where: { id: runId }, data: { brief: { ...brief, name: input.value } as Prisma.InputJsonValue } });
    });
    result = { name: input.value };
  } else if (decision.kind === "STRUCTURE") {
    const o = decision.options as z.output<typeof structureSchema>;
    result = (await installPart(run, { departments: keep(o.departments, exclude) }, ctx)) as unknown as Prisma.InputJsonValue;
  } else if (decision.kind === "CONFIGURATION") {
    const o = decision.options as z.output<typeof configurationSchema>;
    const part: Partial<Manifest> = {
      departments: keep(o.departments, exclude),
      aiEmployees: keep(o.aiEmployees, exclude),
      projects: keep(o.projects as Manifest["projects"], exclude),
      workflows: keep(o.workflows, exclude),
      pipelines: keep(o.pipelines, exclude),
    };
    result = (await installPart(run, part, ctx)) as unknown as Prisma.InputJsonValue;
  }

  await transaction(async (tx) => {
    const { count } = await tx.builderDecision.updateMany({
      where: { id: decisionId, status: "OPEN" },
      data: { status: "DECIDED", choice: { action: input.action, value: input.value ?? null, feedback: input.feedback ?? null, exclude: [...exclude] }, decidedById: ctx.actor.id, decidedAt: new Date() },
    });
    if (!count) throw conflict("This decision was already made", { reason: "builder_decided" });
    if (input.action === "revise") {
      await tx.builderStep.update({ where: { id: decision.stepId }, data: { status: "PENDING", agentTaskId: null, feedback: input.feedback, data: Prisma.DbNull } });
    } else {
      await tx.builderStep.update({ where: { id: decision.stepId }, data: { status: "COMPLETED", completedAt: new Date(), result } });
    }
    await tx.builderRun.updateMany({ where: { id: runId, status: "WAITING_INPUT" }, data: { status: "RUNNING" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "builder.decision.made", resourceType: "builder_decision", resourceId: decisionId, newValue: { kind: decision.kind, action: input.action, value: input.value ?? null } });
  });
  await advanceRun(runId, { inline: true });
  return { ok: true };
}

// ───────────── Reads ─────────────

export async function listRuns(ctx: RequestContext, organizationId: string, companyIds: string[]) {
  const visible: string[] = [];
  for (const id of companyIds) {
    try {
      await authorize(ctx, organizationId, id, "companies.read");
      visible.push(id);
    } catch {
      /* not visible */
    }
  }
  const runs = await db().builderRun.findMany({
    where: { organizationId, companyId: { in: visible } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { company: { select: { id: true, name: true } }, _count: { select: { steps: true, decisions: { where: { status: "OPEN" } } } } },
  });
  const done = await db().builderStep.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) }, status: { in: ["COMPLETED", "SKIPPED"] } }, _count: { _all: true } });
  const doneBy = new Map(done.map((d) => [d.runId, d._count._all]));
  return runs.map((r) => ({ ...r, completedSteps: doneBy.get(r.id) ?? 0, totalSteps: r._count.steps, openDecisions: r._count.decisions }));
}

export async function activeRunFor(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "companies.read");
  return db().builderRun.findFirst({ where: { organizationId, companyId, status: { in: [...ACTIVE] } }, select: { id: true, status: true } });
}

/** Everything the live workspace shows, from the database only. */
export async function getRunView(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "companies.read");
  const run = await runIn(db(), organizationId, companyId, runId);
  const [steps, decisions, sources] = await Promise.all([
    db().builderStep.findMany({ where: { runId }, orderBy: { position: "asc" } }),
    db().builderDecision.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    db().builderSource.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  const taskIds = steps.map((s) => s.agentTaskId).filter((x): x is string => !!x);
  const docIds = [...steps.map((s) => s.brainDocumentId), ...sources.map((s) => s.brainDocumentId)].filter((x): x is string => !!x);
  const where = { organizationId, companyId };
  const [tasks, docs, departments, products, aiEmployees, projects, objectives, items] = await Promise.all([
    db().agentTask.findMany({ where: { ...where, id: { in: taskIds } }, select: { id: true, status: true, title: true, profile: true, startedAt: true, completedAt: true, errorMessage: true, model: true } }),
    db().brainDocument.findMany({ where: { ...where, id: { in: docIds } }, select: { id: true, title: true, tags: true, createdAt: true } }),
    db().department.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, teams: { select: { id: true, name: true }, orderBy: { name: "asc" } } } }),
    db().graphEntity.findMany({ where: { ...where, kind: "PRODUCT" }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true, description: true } }),
    db().aiEmployee.findMany({ where: { ...where, archivedAt: null }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true, profileKey: true, status: true } }),
    db().project.findMany({ where, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, name: true, _count: { select: { workTasks: true } } } }),
    db().objective.findMany({ where, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, title: true } }),
    run.installationId ? db().marketplaceInstallItem.groupBy({ by: ["entityType"], where: { installationId: run.installationId }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  return {
    run: { ...run, brief: parseBrief(run.brief) },
    steps,
    decisions,
    sources,
    tasks: new Map(tasks.map((t) => [t.id, t])),
    docs: new Map(docs.map((d) => [d.id, d])),
    departments,
    products,
    aiEmployees,
    projects,
    objectives,
    installed: Object.fromEntries(items.map((i) => [i.entityType, i._count._all])) as Record<string, number>,
  };
}
export type RunView = Awaited<ReturnType<typeof getRunView>>;

// ───────────── Onboarding ─────────────

export const onboardInput = z.object({
  mode: z.enum(RUN_MODES),
  brief: briefSchema,
  company: createCompanyInput.omit({ name: true }).extend({ name: z.string().trim().max(120).optional() }),
  journey: z.boolean().default(false),
  hold: z.boolean().default(false),
  kit: z.boolean().default(false),
});

/** A unique working name when the founder has not chosen one (the builder's name decision renames it). */
async function workingName(organizationId: string, idea: string) {
  const base = idea.split(/\s+/).slice(0, 5).join(" ").replace(/[^\p{L}\p{N} &-]/gu, "").trim().slice(0, 60) || "New business";
  for (let i = 1; i <= 20; i++) {
    const candidate = i === 1 ? base : `${base} ${i}`;
    if (!(await db().company.findFirst({ where: { organizationId, slug: slugify(candidate) }, select: { id: true } }))) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}

/** Onboarding / "add another business": create the company, then its builder run. */
export async function onboardBusiness(ctx: RequestContext, organizationId: string, raw: z.input<typeof onboardInput>) {
  const input = onboardInput.parse(raw);
  checkBrief(input.mode, input.brief);
  if (input.kit) await assertFeature(ctx, organizationId, "feature.company_builder_advanced");
  const name = input.company.name || input.brief.name || (await workingName(organizationId, input.brief.idea || input.brief.offering || ""));
  const company = await createCompany(ctx, organizationId, {
    ...input.company,
    name,
    stage: input.mode === "NEW_IDEA" ? "IDEA" : "LAUNCHED",
    incorporationCountryCode: input.company.incorporationCountryCode ?? input.brief.countryCode,
    targetMarketCodes: input.company.targetMarketCodes?.length ? input.company.targetMarketCodes : input.brief.targetMarketCodes,
  });
  const brief = { ...input.brief, name: input.company.name || input.brief.name };
  const run = await createRun(ctx, organizationId, company.id, { mode: input.mode, brief, journey: input.journey, hold: input.hold, kit: input.kit });
  // The journey resumes at Intelligence from now on (server-side, so a reload or another device lands there).
  if (input.journey && ctx.actor.type === "USER" && ctx.actor.id) {
    const data = { runId: run.id, journeyStage: "intelligence" };
    await db().builderOnboarding.upsert({ where: { userId: ctx.actor.id }, create: { userId: ctx.actor.id, ...data }, update: data });
  }
  return { companyId: company.id, runId: run.id, status: run.status };
}
