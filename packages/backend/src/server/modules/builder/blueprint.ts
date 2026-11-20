import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { cancelTask } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { writeAudit } from "@/server/modules/audit/service";
import { ingestDocument, ingestDocumentInput } from "@/server/modules/brain/service";
import { createEntity } from "@/server/modules/graph/service";
import { createGoal } from "@/server/modules/objectives/goals";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createProduct } from "@/server/modules/work/product-core";
import { createEmployee, defaultLevelFor, departmentOf, STARTER_TEAM } from "@/server/modules/workforce/service";
import { advanceRun, installPart } from "./engine";
import { kickoffFirstWeek, type FirstWeekResult } from "./first-week";
import { BLUEPRINT_KEY, blueprintInput, WORKFORCE_KEY, workforceInput, type WorkforcePlan } from "./steps";

/**
 * Journey actions on a builder run: documents added at the Vision stage (into Company Brain, recorded as sources), the
 * founder's approval of the edited Company Blueprint (records are created through each module's own service, so its
 * permissions apply — sections the founder may not manage are reported, never forced) and of the AI workforce (hired
 * through the workforce service with the reporting lines). Approving works whether the AI proposed the content or the
 * founder built it by hand (AI or research not configured): earlier steps that are still open are skipped then.
 */

const OPEN_STEP = ["PENDING", "RUNNING", "WAITING_INPUT", "FAILED"] as const;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

async function journeyRun(organizationId: string, companyId: string, runId: string) {
  if (!isUuid(runId)) throw notFound("Builder run");
  const run = await db().builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true } } } });
  if (!run) throw notFound("Builder run");
  if (run.status === "CANCELLED") throw conflict("This run was cancelled", { reason: "builder_not_active" });
  return run;
}

// ───────────── Vision documents ─────────────

export const runDocumentInput = ingestDocumentInput.pick({ title: true, filename: true, content: true, contentBase64: true });

/** Add a founder document to Company Brain for this run (the research steps read it); recorded as a source either way. */
export async function addRunDocument(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof runDocumentInput>) {
  const input = runDocumentInput.parse(raw);
  await requirePermission(ctx, "companies.manage", await companyChain(db(), organizationId, companyId));
  const run = await journeyRun(organizationId, companyId, runId);
  if (run.status === "COMPLETED") throw conflict("This run is finished", { reason: "builder_not_active" });
  const title = (input.title || input.filename || "Document").slice(0, 200);
  const source = { organizationId, companyId, runId, kind: "document", title };
  try {
    const doc = await ingestDocument(ctx, organizationId, companyId, { ...input, title, tags: ["builder", "founder-document"] });
    const s = await db().builderSource.create({ data: { ...source, status: "INGESTED", brainDocumentId: doc.id }, select: { id: true } });
    return { sourceId: s.id, documentId: doc.id };
  } catch (err) {
    const existing = isAppError(err) && typeof err.details?.documentId === "string" ? err.details.documentId : null;
    if (existing) {
      const s = await db().builderSource.create({ data: { ...source, status: "INGESTED", brainDocumentId: existing }, select: { id: true } });
      return { sourceId: s.id, documentId: existing };
    }
    await db().builderSource.create({ data: { ...source, status: "FAILED", errorMessage: (err instanceof Error ? err.message : "upload_failed").slice(0, 300) } });
    throw err;
  }
}

// ───────────── Shared approval mechanics ─────────────

/** Claim the step for applying (any open state); returns the previous status so a failure can restore it. */
async function claim(runId: string, key: string) {
  const step = await db().builderStep.findFirst({ where: { runId, key } });
  if (!step) throw notFound("Step");
  if (step.status === "COMPLETED") throw conflict("This was already approved", { reason: "builder_already_applied" });
  if (step.status === "APPLYING") throw conflict("This is being applied right now", { reason: "builder_busy" });
  const { count } = await db().builderStep.updateMany({ where: { id: step.id, status: { in: [...OPEN_STEP, "SKIPPED", "CANCELLED"] } }, data: { status: "APPLYING" } });
  if (!count) throw conflict("This is being applied right now", { reason: "builder_busy" });
  return step;
}

async function restore(stepId: string, status: string, err: unknown) {
  await db().builderStep.update({
    where: { id: stepId },
    data: { status: status === "PENDING" || status === "RUNNING" ? "WAITING_INPUT" : (status as "WAITING_INPUT"), errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
  });
}

/** Complete the step, skip earlier open steps (manual path), close its decision, keep the run going, remember the stage. */
async function finish(ctx: RequestContext, run: { id: string; organizationId: string; companyId: string }, step: { id: string; position: number; status: string; agentTaskId: string | null }, data: unknown, result: unknown, action: string, nextStage: string) {
  const running = await transaction(async (tx) => {
    const earlier = await tx.builderStep.findMany({ where: { runId: run.id, position: { lt: step.position }, status: { in: [...OPEN_STEP] } }, select: { id: true, status: true, agentTaskId: true } });
    if (earlier.length) await tx.builderStep.updateMany({ where: { id: { in: earlier.map((s) => s.id) } }, data: { status: "SKIPPED", completedAt: new Date() } });
    await tx.builderStep.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), errorCode: null, errorMessage: null, errorIssues: [], data: data as Prisma.InputJsonValue, result: result as Prisma.InputJsonValue } });
    await tx.builderDecision.updateMany({ where: { runId: run.id, stepId: step.id, status: "OPEN" }, data: { status: "DECIDED", choice: { action: "approve", edited: true }, decidedById: ctx.actor.id, decidedAt: new Date() } });
    await tx.builderRun.updateMany({ where: { id: run.id, status: { in: ["DRAFT", "WAITING_INPUT", "FAILED", "RUNNING"] } }, data: { status: "RUNNING", errorMessage: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: run.organizationId, action, resourceType: "builder_run", resourceId: run.id, newValue: result });
    if (ctx.actor.type === "USER" && ctx.actor.id) {
      const row = await tx.builderOnboarding.findUnique({ where: { userId: ctx.actor.id }, select: { draft: true } });
      if (row) {
        const draft = { ...((row.draft ?? {}) as Record<string, unknown>) };
        delete draft[nextStage === "workforce" ? "blueprint" : "workforce"];
        await tx.builderOnboarding.update({ where: { userId: ctx.actor.id }, data: { journeyStage: nextStage, draft: draft as Prisma.InputJsonValue } });
      }
    }
    const own = step.status === "RUNNING" && step.agentTaskId ? [step.agentTaskId] : [];
    return [...own, ...earlier.filter((s) => s.status === "RUNNING" && s.agentTaskId).map((s) => s.agentTaskId!)];
  });
  for (const taskId of running) await cancelTask(ctx, run.organizationId, run.companyId, taskId).catch(() => undefined);
  await advanceRun(run.id, { inline: true }).catch(() => undefined);
}

// ───────────── Company Blueprint ─────────────

type Section = { created: number; skipped: number; forbidden?: string; failed?: number };

export async function approveBlueprint(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof blueprintInput>) {
  const input = blueprintInput.parse(raw);
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.manage", chain);
  const run = await journeyRun(organizationId, companyId, runId);
  if (!run.journey) throw conflict("Only journey runs have a Company Blueprint", { reason: "builder_not_journey" });
  const step = await claim(runId, BLUEPRINT_KEY);
  const summary: Record<string, unknown> = {};
  try {
    // Departments + teams, objectives with milestones, projects with tasks and workflows: the marketplace installer
    // (per-section permission checks, idempotent by name, every record tracked under the run's installation).
    Object.assign(summary, await installPart({ ...run, company: run.company }, { departments: input.departments, objectives: input.objectives, projects: input.projects, workflows: input.workflows }, ctx));

    // Products: the product lifecycle service (projects.manage) with its graph entity, else a graph product (graph.manage).
    const products: Section = { created: 0, skipped: 0 };
    const [canProducts, canGraph] = [await can(ctx, "projects.manage", chain), await can(ctx, "graph.manage", chain)];
    if (input.products.length && !canProducts && !canGraph) products.forbidden = "projects.manage";
    else {
      for (const p of input.products) {
        const description = [p.description, p.pricing ? `Pricing: ${p.pricing}` : ""].filter(Boolean).join("\n").slice(0, 2000) || undefined;
        try {
          if (canProducts) await createProduct(ctx, organizationId, companyId, { name: p.name, description, createGraphEntity: canGraph });
          else await createEntity(ctx, organizationId, companyId, { kind: "PRODUCT", name: p.name, description });
          products.created++;
        } catch (err) {
          if (isAppError(err) && err.code === "conflict") products.skipped++;
          else throw err;
        }
      }
    }
    summary.products = products;

    // Company goals (objectives service).
    const goals: Section = { created: 0, skipped: 0 };
    if (input.goals.length && !(await can(ctx, "objectives.manage", chain))) goals.forbidden = "objectives.manage";
    else {
      const existing = new Set((await db().companyGoal.findMany({ where: { organizationId, companyId }, select: { title: true } })).map((g) => g.title));
      for (const g of input.goals) {
        if (existing.has(g.title)) {
          goals.skipped++;
          continue;
        }
        await createGoal(ctx, organizationId, companyId, { title: g.title, description: g.description ?? null, horizon: g.horizon });
        goals.created++;
      }
    }
    summary.goals = goals;
  } catch (err) {
    await restore(step.id, step.status, err);
    throw err;
  }
  await finish(ctx, run, step, input, summary, "builder.blueprint.approved", "workforce");
  return { summary };
}

// ───────────── AI workforce ─────────────

const RANK = { EXECUTIVE: 0, MANAGER: 1, SPECIALIST: 2 } as const;

/** The standard starter team as a plan (used when the AI could not propose one): CEO → managers → specialists. */
export function starterPlan(): WorkforcePlan {
  const team = STARTER_TEAM.filter((m) => profileByKey(m.profileKey)).map((m) => ({ key: m.profileKey.replace(/[^a-z0-9_-]/g, "").slice(0, 40), profile: m.profileKey, name: m.name, level: defaultLevelFor(m.profileKey), responsibilities: [] as string[], goals: [] as string[], reportsTo: null as string | null, title: undefined as string | undefined }));
  const ceo = team.find((m) => m.level === "EXECUTIVE");
  for (const m of team) {
    if (m === ceo) continue;
    const manager = m.level === "SPECIALIST" ? team.find((x) => x.level === "MANAGER" && departmentOf(x.profile) === departmentOf(m.profile)) : null;
    m.reportsTo = manager?.key ?? ceo?.key ?? null;
  }
  return { team };
}

/** Members ordered so every manager comes before its reports; unknown or cyclic managers are rejected. */
function ordered(plan: WorkforcePlan) {
  const byKey = new Map(plan.team.map((m) => [m.key, m]));
  if (byKey.size !== plan.team.length) throw invalid("Every AI employee needs a unique key", { reason: "builder_workforce_duplicate_key" });
  const issues: { path: string; message: string }[] = [];
  plan.team.forEach((m, i) => {
    if (!profileByKey(m.profile)) issues.push({ path: `team.${i}.profile`, message: `Unknown role ${m.profile}` });
    if (m.reportsTo && !byKey.has(m.reportsTo)) issues.push({ path: `team.${i}.reportsTo`, message: `Unknown manager ${m.reportsTo}` });
    if (m.reportsTo === m.key) issues.push({ path: `team.${i}.reportsTo`, message: "Cannot report to itself" });
  });
  if (issues.length) throw invalid("Some AI employees need fixing", { reason: "builder_workforce_invalid", issues });
  const out: typeof plan.team = [];
  const placed = new Set<string>();
  const pending = [...plan.team].sort((a, b) => RANK[a.level] - RANK[b.level]);
  for (let guard = 0; pending.length && guard < 100; guard++) {
    const i = pending.findIndex((m) => !m.reportsTo || placed.has(m.reportsTo));
    if (i < 0) throw invalid("The reporting lines contain a loop", { reason: "builder_workforce_cycle" });
    const [m] = pending.splice(i, 1);
    out.push(m!);
    placed.add(m!.key);
  }
  return out;
}

export async function approveWorkforce(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof workforceInput>) {
  const input = workforceInput.parse(raw);
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.manage", chain);
  if (input.team.length) await requirePermission(ctx, "agents.manage", chain);
  const run = await journeyRun(organizationId, companyId, runId);
  if (!run.journey) throw conflict("Only journey runs have a workforce plan", { reason: "builder_not_journey" });
  const blueprint = await db().builderStep.findFirst({ where: { runId, key: BLUEPRINT_KEY }, select: { status: true } });
  if (blueprint && blueprint.status !== "COMPLETED" && blueprint.status !== "SKIPPED") throw conflict("Approve the Company Blueprint first", { reason: "builder_blueprint_first" });
  const team = ordered(input);
  const step = await claim(runId, WORKFORCE_KEY);
  const ids = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  try {
    const existing = await db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, profileKey: true } });
    for (const m of team) {
      const same = existing.find((e) => e.name === m.name && e.profileKey === m.profile);
      if (same) {
        ids.set(m.key, same.id);
        skipped++;
        continue;
      }
      const manager = m.reportsTo ? ids.get(m.reportsTo) : undefined;
      const e = await createEmployee(ctx, organizationId, companyId, {
        profileKey: m.profile,
        name: m.name,
        level: m.level,
        jobTitle: m.title ?? null,
        responsibilities: m.responsibilities,
        goals: m.goals,
        ...(manager ? { managerEmployeeId: manager } : {}),
      });
      ids.set(m.key, e.id);
      created++;
    }
  } catch (err) {
    await restore(step.id, step.status, err);
    throw err;
  }
  const result = { aiEmployees: { created, skipped }, employeeIds: [...ids.values()] };
  await finish(ctx, run, step, input, result, "builder.workforce.approved", "launch");
  // The company's first real work: the AI CEO's weekly plan and each department's first deliverable (never blocks hiring).
  const firstWeek = await kickoffFirstWeek(ctx, organizationId, companyId, runId).catch((err): FirstWeekResult => ({ created: 0, skipped: 0, failed: 1, reason: isAppError(err) ? err.code : "internal_error" }));
  return { ...result, firstWeek };
}
