import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { MAX_DEPTH } from "@/server/modules/automation/engine";
import { cancelRun, retryRun, RUN_STATUSES, setWorkflowStatus, testRun } from "@/server/modules/automation/service";
import { writeAudit } from "@/server/modules/audit/service";
import { capabilitiesFor, daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, requirePlatform } from "./access";

/**
 * Global workflows admin (stream C): every organization's workflows (Automation OS) with run health, and the platform
 * actions on them. Every action goes through the automation service under the system principal (its rules apply:
 * publish before enabling, plan limits, archived workflows never run, loop protection and the per-minute run limit in
 * the engine) and is audited as the admin with a reason. Step input / output is tenant data: shown only with
 * `platform.data.read`.
 */

const READ = ["platform.ai.read", "platform.ai.manage"];
export const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
/** Mirrors the engine's per-workflow cap (automation/engine.ts RUNS_PER_MINUTE) for manual admin runs. */
const MANUAL_RUNS_PER_MINUTE = 30;

export const workflowFilters = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  status: z.enum(WORKFLOW_STATUSES).optional().catch(undefined),
  trigger: z.enum(["event", "schedule", "webhook", "manual"]).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(100).default(50).catch(50),
});

/** Cross-organization directory with 30-day run health per workflow. */
export async function listWorkflowsAdmin(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = workflowFilters.parse(raw);
  const where: Prisma.WorkflowWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.trigger ? { triggerType: f.trigger } : {}),
    ...(f.q ? (isUuid(f.q) ? { id: f.q } : { name: { contains: f.q, mode: "insensitive" } }) : {}),
  };
  const [rows, byStatus, controls] = await Promise.all([
    db().workflow.findMany({ where, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}), select: { id: true, organizationId: true, companyId: true, name: true, status: true, triggerType: true, triggerKey: true, autonomyMode: true, currentVersion: true, updatedAt: true, createdAt: true } }),
    db().workflow.groupBy({ by: ["status"], _count: { _all: true } }),
    getControls(),
  ]);
  const page = rows.slice(0, f.limit);
  const ids = page.map((w) => w.id);
  const [runs, last, orgs, companies] = await Promise.all([
    ids.length ? db().workflowRun.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: ids }, createdAt: { gte: daysAgo(30) } }, _count: { _all: true } }) : [],
    ids.length ? db().$queryRaw<{ workflow_id: string; at: Date; status: string }[]>(Prisma.sql`SELECT DISTINCT ON (workflow_id) workflow_id, created_at AS at, status::text AS status FROM workflow_runs WHERE workflow_id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) ORDER BY workflow_id, created_at DESC`) : [],
    db().organization.findMany({ where: { id: { in: [...new Set(page.map((w) => w.organizationId))] } }, select: { id: true, name: true } }),
    db().company.findMany({ where: { id: { in: [...new Set(page.map((w) => w.companyId))] } }, select: { id: true, name: true } }),
  ]);
  return {
    automationsEnabled: controls.automationsEnabled,
    counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<string, number>>,
    nextCursor: rows.length > f.limit ? page[page.length - 1]!.id : null,
    filters: f,
    data: page.map((w) => {
      const mine = runs.filter((r) => r.workflowId === w.id);
      const total = mine.reduce((a, r) => a + r._count._all, 0);
      const ok = mine.find((r) => r.status === "SUCCEEDED")?._count._all ?? 0;
      const failed = mine.find((r) => r.status === "FAILED")?._count._all ?? 0;
      const l = last.find((x) => x.workflow_id === w.id);
      return { ...w, organizationName: orgs.find((o) => o.id === w.organizationId)?.name ?? w.organizationId.slice(0, 8), companyName: companies.find((c) => c.id === w.companyId)?.name ?? "", runs30d: total, failed30d: failed, successRate: ok + failed > 0 ? ok / (ok + failed) : null, lastRun: l ? { at: l.at, status: l.status } : null };
    }),
  };
}

/** One workflow: versions, recent runs, 30-day health, limits. */
export async function getWorkflowAdmin(ctx: RequestContext, workflowId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(workflowId)) throw notFound("Workflow");
  const wf = await db().workflow.findUnique({ where: { id: workflowId }, select: { id: true, organizationId: true, companyId: true, name: true, description: true, status: true, ownerId: true, triggerType: true, triggerKey: true, autonomyMode: true, currentVersion: true, currentVersionId: true, templateKey: true, lastScheduleSlot: true, createdAt: true, updatedAt: true } });
  if (!wf) throw notFound("Workflow");
  const [versions, runs, byStatus, org, company, owner, audit, controls, recentMinute] = await Promise.all([
    db().workflowVersion.findMany({ where: { workflowId: wf.id }, orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, createdAt: true, createdById: true } }),
    db().workflowRun.findMany({ where: { workflowId: wf.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, status: true, triggerType: true, isTest: true, depth: true, error: true, createdAt: true, startedAt: true, finishedAt: true, deadLetteredAt: true } }),
    db().workflowRun.groupBy({ by: ["status"], where: { workflowId: wf.id, createdAt: { gte: daysAgo(30) } }, _count: { _all: true } }),
    db().organization.findUnique({ where: { id: wf.organizationId }, select: { id: true, name: true } }),
    db().company.findUnique({ where: { id: wf.companyId }, select: { id: true, name: true } }),
    db().user.findUnique({ where: { id: wf.ownerId }, select: { id: true, name: true } }),
    db().auditLog.findMany({ where: { resourceType: "workflow", resourceId: wf.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, actorType: true, actorId: true, reason: true, createdAt: true, category: true } }),
    getControls(),
    db().workflowRun.count({ where: { workflowId: wf.id, createdAt: { gte: new Date(Date.now() - 60_000) } } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<string, number>>;
  const ok = counts.SUCCEEDED ?? 0;
  const failed = counts.FAILED ?? 0;
  const durations = runs.filter((r) => r.startedAt && r.finishedAt).map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime()).sort((a, b) => a - b);
  return {
    ...wf,
    organization: org ?? { id: wf.organizationId, name: wf.organizationId.slice(0, 8) },
    company: company ?? { id: wf.companyId, name: "" },
    owner,
    versions,
    runs,
    counts30d: counts,
    successRate: ok + failed > 0 ? ok / (ok + failed) : null,
    medianDurationMs: durations.length ? durations[Math.floor(durations.length / 2)]! : null,
    limits: { maxDepth: MAX_DEPTH, runsPerMinute: MANUAL_RUNS_PER_MINUTE, runsLastMinute: recentMinute, automationsEnabled: controls.automationsEnabled },
    audit,
  };
}

/** One run: the execution trace (steps), approvals; step data only with platform.data.read. */
export async function getWorkflowRunAdmin(ctx: RequestContext, runId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(runId)) throw notFound("Run");
  const run = await db().workflowRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { startedAt: "asc" } }, approvals: { select: { id: true, stepId: true, title: true, status: true, createdAt: true, decidedAt: true, expiresAt: true } }, workflow: { select: { id: true, name: true, status: true } } } });
  if (!run) throw notFound("Run");
  const caps = await capabilitiesFor(ctx, ["platform.data.read"]);
  const sensitive = caps["platform.data.read"];
  const org = await db().organization.findUnique({ where: { id: run.organizationId }, select: { id: true, name: true } });
  return {
    id: run.id,
    status: run.status,
    triggerType: run.triggerType,
    triggerEventId: run.triggerEventId,
    isTest: run.isTest,
    depth: run.depth,
    error: run.error,
    waitingFor: run.waitingFor,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    deadLetteredAt: run.deadLetteredAt,
    nextRunAt: run.nextRunAt,
    workflow: run.workflow,
    organization: org ?? { id: run.organizationId, name: run.organizationId.slice(0, 8) },
    triggerData: sensitive ? run.triggerData : null,
    sensitive,
    steps: run.steps.map((s) => ({ id: s.id, stepId: s.stepId, stepType: s.stepType, status: s.status, attempts: s.attempts, error: s.error, startedAt: s.startedAt, finishedAt: s.finishedAt, durationMs: s.finishedAt ? s.finishedAt.getTime() - s.startedAt.getTime() : null, input: sensitive ? s.input : null, output: sensitive ? s.output : null })),
    approvals: run.approvals,
  };
}

/** Recent runs across organizations (run explorer), keyset by id. */
export async function listWorkflowRunsAdmin(ctx: RequestContext, raw: { status?: string; org?: string; cursor?: string } = {}) {
  await requireAnyPlatform(ctx, READ);
  const status = (RUN_STATUSES as readonly string[]).includes(raw.status ?? "") ? (raw.status as (typeof RUN_STATUSES)[number]) : undefined;
  const rows = await db().workflowRun.findMany({
    where: { ...(status ? { status } : {}), ...(raw.org && isUuid(raw.org) ? { organizationId: raw.org } : {}), createdAt: { gte: daysAgo(30) } },
    orderBy: { id: "desc" },
    take: 51,
    ...(raw.cursor && isUuid(raw.cursor) ? { cursor: { id: raw.cursor }, skip: 1 } : {}),
    select: { id: true, organizationId: true, status: true, triggerType: true, isTest: true, error: true, createdAt: true, finishedAt: true, workflow: { select: { id: true, name: true } } },
  });
  const page = rows.slice(0, 50);
  const orgs = await db().organization.findMany({ where: { id: { in: [...new Set(page.map((r) => r.organizationId))] } }, select: { id: true, name: true } });
  return { data: page.map((r) => ({ ...r, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? r.organizationId.slice(0, 8) })), nextCursor: rows.length > 50 ? page[49]!.id : null };
}

export const workflowActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), reason: reasonSchema }),
  z.object({ action: z.literal("pause"), reason: reasonSchema }),
  z.object({ action: z.literal("archive"), reason: reasonSchema, confirm: z.string().optional() }),
  z.object({ action: z.literal("clone"), reason: reasonSchema }),
  z.object({ action: z.literal("test"), reason: reasonSchema, confirm: z.string().optional(), data: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}) }),
  z.object({ action: z.literal("run"), reason: reasonSchema, confirm: z.string().optional(), data: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}) }),
]);

/**
 * Platform actions on one workflow (platform.ai.manage). Enable / pause / archive go through setWorkflowStatus;
 * clone copies the draft as a new DRAFT owned by the same member (never enabled); test runs the draft and run
 * executes the published version with a sample payload: both perform real actions as the workflow owner, so they
 * need the typed confirmation RUN, refuse when automations are switched off platform-wide, and respect the engine's
 * per-minute cap and loop protection (admin runs start at depth 0).
 */
export async function workflowAction(ctx: RequestContext, workflowId: string, raw: z.input<typeof workflowActionInput>) {
  const input = workflowActionInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isUuid(workflowId)) throw notFound("Workflow");
  const wf = await db().workflow.findUnique({ where: { id: workflowId }, select: { id: true, organizationId: true, companyId: true, name: true, status: true, draft: true, description: true, ownerId: true, templateKey: true, currentVersionId: true } });
  if (!wf) throw notFound("Workflow");
  const sys = systemContext(ctx.requestId);
  let result: Record<string, unknown> = { ok: true };
  switch (input.action) {
    case "enable":
      result = await setWorkflowStatus(sys, wf.organizationId, wf.companyId, wf.id, { status: "ACTIVE" });
      break;
    case "pause":
      result = await setWorkflowStatus(sys, wf.organizationId, wf.companyId, wf.id, { status: "PAUSED" });
      break;
    case "archive":
      requireConfirmation(input.confirm, wf.name);
      result = await setWorkflowStatus(sys, wf.organizationId, wf.companyId, wf.id, { status: "ARCHIVED" });
      break;
    case "clone": {
      if (!ctx.actor.id) throw conflict("Only a person can clone workflows");
      const copy = await db().workflow.create({ data: { organizationId: wf.organizationId, companyId: wf.companyId, name: `${wf.name} (copy)`.slice(0, 160), description: wf.description, ownerId: wf.ownerId, createdById: ctx.actor.id, draft: wf.draft as Prisma.InputJsonValue, templateKey: wf.templateKey, status: "DRAFT" }, select: { id: true } });
      result = { ok: true, id: copy.id };
      break;
    }
    case "test":
    case "run": {
      requireConfirmation(input.confirm, "RUN");
      const c = await getControls();
      if (!c.automationsEnabled) throw conflict("Automations are switched off platform-wide (Controls)", { reason: "automations_disabled" });
      if (input.action === "run" && !wf.currentVersionId) throw conflict("Publish the workflow before running it", { reason: "automation_workflow_unpublished" });
      const recent = await db().workflowRun.count({ where: { workflowId: wf.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });
      if (recent >= MANUAL_RUNS_PER_MINUTE) throw conflict(`Rate limit: more than ${MANUAL_RUNS_PER_MINUTE} runs of this workflow in one minute`, { reason: "automation_rate_limited" });
      result = await testRun(sys, wf.organizationId, wf.companyId, wf.id, { data: input.data, useDraft: input.action === "test" });
      break;
    }
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: wf.organizationId, action: `platform.workflow.${input.action}`, resourceType: "workflow", resourceId: wf.id, oldValue: { status: wf.status }, newValue: result, reason: input.reason }));
  return result;
}

export const runActionInput = z.object({ action: z.enum(["cancel", "retry"]), reason: reasonSchema });

/** Cancel (queued / waiting) or retry (failed / cancelled) one run through the automation service, audited. */
export async function workflowRunAction(ctx: RequestContext, runId: string, raw: z.input<typeof runActionInput>) {
  const input = runActionInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isUuid(runId)) throw notFound("Run");
  const run = await db().workflowRun.findUnique({ where: { id: runId }, select: { id: true, organizationId: true, companyId: true, status: true, workflowId: true } });
  if (!run) throw notFound("Run");
  const sys = systemContext(ctx.requestId);
  if (input.action === "cancel") await cancelRun(sys, run.organizationId, run.companyId, run.id);
  else {
    const c = await getControls();
    if (!c.automationsEnabled) throw conflict("Automations are switched off platform-wide (Controls)", { reason: "automations_disabled" });
    await retryRun(sys, run.organizationId, run.companyId, run.id);
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: run.organizationId, action: `platform.workflow_run.${input.action}`, resourceType: "workflow_run", resourceId: run.id, oldValue: { status: run.status }, reason: input.reason }));
  return { ok: true };
}
