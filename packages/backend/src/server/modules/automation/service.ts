import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Db, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createTask } from "@/server/modules/agents/service";
import { assertLimit } from "@/server/modules/entitlements/service";
import { currentSlot, createRun, processRun, type TriggerEventData } from "./engine";
import { EMPTY_DEFINITION, flattenSteps, triggerKeyOf, validateDefinition, type Definition } from "./definition";
import { templateByKey } from "./templates";

type Perm = "workflows.read" | "workflows.manage" | "workflows.execute";

const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;

/** Workflow autonomy modes (AutopilotMode), see ./governance.ts. */
export const WORKFLOW_AUTONOMY_MODES = ["OFF", "MANUAL", "ASSISTED", "APPROVAL_REQUIRED", "AUTONOMOUS"] as const;
export const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const RUN_STATUSES = ["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

export async function authorizeWorkflows(ctx: RequestContext, organizationId: string, companyId: string, permission: Perm, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

function definitionOrThrow(raw: unknown): Definition {
  const r = validateDefinition(raw);
  if (!r.ok) throw new AppError("validation_error", "The workflow definition is invalid", { reason: "automation_workflow_invalid", issues: r.issues });
  return r.definition;
}

/** Parse a stored draft leniently (drafts may be incomplete). */
function draftOf(json: Prisma.JsonValue): Definition {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  return { ...EMPTY_DEFINITION, ...(obj as Partial<Definition>) } as Definition;
}

// ───────────────────────────── Workflows ─────────────────────────────

export interface WorkflowFilters {
  q?: string;
  status?: (typeof WORKFLOW_STATUSES)[number];
}

export function parseWorkflowFilters(raw: Record<string, string | string[] | undefined>): WorkflowFilters {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const status = one("status");
  return { q: one("q")?.slice(0, 200), status: (WORKFLOW_STATUSES as readonly string[]).includes(status ?? "") ? (status as WorkflowFilters["status"]) : undefined };
}

export async function listWorkflows(ctx: RequestContext, organizationId: string, companyId: string, f: WorkflowFilters = {}) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const rows = await db().workflow.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.status ? { status: f.status } : { status: { not: "ARCHIVED" } }),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
    select: { id: true, name: true, description: true, status: true, currentVersion: true, triggerType: true, triggerKey: true, ownerId: true, updatedAt: true, draft: true, autonomyMode: true },
  });
  const ids = rows.map((r) => r.id);
  const [stats, owners] = await Promise.all([
    ids.length ? db().workflowRun.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } }) : [],
    db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, name: true } }),
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  return rows.map((r) => {
    const s = stats.filter((x) => x.workflowId === r.id);
    const runs = s.reduce((n, x) => n + x._count._all, 0);
    const failed = s.find((x) => x.status === "FAILED")?._count._all ?? 0;
    const draft = draftOf(r.draft);
    return { ...r, draft: undefined, draftTrigger: draft.trigger, ownerName: ownerName.get(r.ownerId) ?? null, runs30d: runs, failed30d: failed };
  });
}

export async function getWorkflow(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  if (!isUuid(workflowId)) throw notFound("Workflow");
  const wf = await db().workflow.findFirst({
    where: { id: workflowId, organizationId, companyId },
    include: { versions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, createdAt: true, createdById: true } } },
  });
  if (!wf) throw notFound("Workflow");
  const current = wf.currentVersionId ? await db().workflowVersion.findUnique({ where: { id: wf.currentVersionId }, select: { definition: true } }) : null;
  const owner = await db().user.findUnique({ where: { id: wf.ownerId }, select: { id: true, name: true } });
  return { ...wf, draft: draftOf(wf.draft), published: current ? draftOf(current.definition) : null, owner };
}

export const createWorkflowInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  templateKey: z.string().max(60).optional(),
});

export async function createWorkflow(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createWorkflowInput>, opts: { draft?: Definition } = {}) {
  const input = createWorkflowInput.parse(raw);
  const template = input.templateKey ? templateByKey(input.templateKey) : undefined;
  if (input.templateKey && !template) throw invalid("Unknown template");
  return transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage", tx);
    if (!ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
    const wf = await tx.workflow.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: input.description || null,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        draft: (opts.draft ?? template?.definition ?? EMPTY_DEFINITION) as unknown as Prisma.InputJsonValue,
        templateKey: template?.key ?? null,
      },
      select: { id: true, name: true, status: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow.created", resourceType: "workflow", resourceId: wf.id, newValue: { name: wf.name, template: template?.key } });
    return wf;
  });
}

/** Outline every stored draft must have (steps are free-form objects until publishing). */
const draftOutline = z
  .object({
    trigger: z.object({ type: z.enum(["event", "schedule", "webhook", "manual"]) }).passthrough(),
    variables: z.array(z.object({ name: z.string().max(40), value: z.string().max(2000) })).max(30).default([]),
    steps: z.array(z.object({ id: z.string().max(40), type: z.enum(["condition", "branch", "action", "delay", "set_variable"]) }).passthrough()).max(50),
  })
  .strict();

export const updateWorkflowInput = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  /** The working definition. Drafts are structurally validated; publishing validates fully. */
  draft: z.unknown().optional(),
  ownerId: uuid.optional(),
  /** Autonomy of external actions in runs the workflow starts itself (./governance.ts). */
  autonomyMode: z.enum(WORKFLOW_AUTONOMY_MODES).optional(),
});

async function findWorkflow(tx: Tx | Db, organizationId: string, companyId: string, workflowId: string) {
  if (!isUuid(workflowId)) throw notFound("Workflow");
  const wf = await tx.workflow.findFirst({ where: { id: workflowId, organizationId, companyId } });
  if (!wf) throw notFound("Workflow");
  return wf;
}

export async function updateWorkflow(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string, raw: z.input<typeof updateWorkflowInput>) {
  const input = updateWorkflowInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage", tx);
    const wf = await findWorkflow(tx, organizationId, companyId, workflowId);
    if (wf.status === "ARCHIVED") throw conflict("Archived workflows cannot be edited", { reason: "automation_workflow_archived" });
    let draft: Definition | undefined;
    if (input.draft !== undefined) {
      // Drafts may be incomplete (empty fields while editing); only their outline is checked here. Publishing validates fully.
      const outline = draftOutline.safeParse(input.draft);
      if (!outline.success) throw new AppError("validation_error", "The workflow definition is invalid", { reason: "automation_workflow_invalid", issues: outline.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      const full = validateDefinition(input.draft);
      draft = full.ok ? full.definition : (outline.data as unknown as Definition);
    }
    if (input.ownerId && input.ownerId !== wf.ownerId) {
      const member = await tx.membership.findFirst({ where: { organizationId, userId: input.ownerId, status: "ACTIVE" }, select: { userId: true } });
      if (!member || !grantsAllow(await loadGrants(tx, "USER", input.ownerId), "workflows.execute", chain)) {
        throw invalid("The new owner must be allowed to execute workflows here", { reason: "automation_workflow_owner_ineligible" });
      }
    }
    const updated = await tx.workflow.update({
      where: { id: wf.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(draft ? { draft: draft as unknown as Prisma.InputJsonValue } : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        ...(input.autonomyMode ? { autonomyMode: input.autonomyMode } : {}),
      },
      select: { id: true, name: true, status: true, updatedAt: true, autonomyMode: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow.updated", resourceType: "workflow", resourceId: wf.id, oldValue: { name: wf.name, ownerId: wf.ownerId, autonomyMode: wf.autonomyMode }, newValue: { name: updated.name, ownerId: input.ownerId, draftChanged: !!draft, autonomyMode: input.autonomyMode } });
    return updated;
  });
}

/** Publish the draft as a new immutable version (becomes the version new runs pin). */
export async function publishWorkflow(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string) {
  return transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage", tx);
    const wf = await findWorkflow(tx, organizationId, companyId, workflowId);
    if (wf.status === "ARCHIVED") throw conflict("Archived workflows cannot be published", { reason: "automation_workflow_archived" });
    const def = definitionOrThrow(wf.draft);
    if (def.trigger.type === "webhook") {
      const hook = await tx.integrationHook.findFirst({ where: { id: def.trigger.hookId, organizationId, companyId }, select: { id: true } });
      if (!hook) throw invalid("The selected incoming webhook does not exist", { reason: "automation_workflow_hook_missing" });
    }
    const last = await tx.workflowVersion.findFirst({ where: { workflowId: wf.id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    const v = await tx.workflowVersion.create({
      data: { organizationId, companyId, workflowId: wf.id, version, definition: def as unknown as Prisma.InputJsonValue, createdById: ctx.actor.id ?? wf.ownerId },
      select: { id: true, version: true },
    });
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { timezone: true } });
    await tx.workflow.update({
      where: { id: wf.id },
      data: {
        currentVersionId: v.id,
        currentVersion: v.version,
        triggerType: def.trigger.type,
        triggerKey: triggerKeyOf(def.trigger),
        // A schedule's slot that already passed today does not fire retroactively on publish.
        lastScheduleSlot: def.trigger.type === "schedule" ? currentSlot(def.trigger.schedule, new Date(), company.timezone) : null,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow.published", resourceType: "workflow", resourceId: wf.id, newValue: { version: v.version, trigger: def.trigger.type } });
    return v;
  });
}

export const statusInput = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) });

export async function setWorkflowStatus(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string, raw: z.input<typeof statusInput>) {
  const { status } = statusInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage", tx);
    const wf = await findWorkflow(tx, organizationId, companyId, workflowId);
    if (status === "ACTIVE" && !wf.currentVersionId) throw conflict("Publish the workflow before enabling it", { reason: "automation_workflow_unpublished" });
    if (wf.status === "ARCHIVED" && status !== "ARCHIVED") throw conflict("Archived workflows cannot be re-enabled", { reason: "automation_workflow_archived" });
    // Active automations of the plan (docs/entitlements.md).
    if (status === "ACTIVE" && wf.status !== "ACTIVE") await assertLimit(ctx, organizationId, "automations.active.max", 1);
    await tx.workflow.update({ where: { id: wf.id }, data: { status } });
    if (status === "ARCHIVED") {
      await tx.workflowRun.updateMany({ where: { workflowId: wf.id, status: { in: ["QUEUED", "WAITING"] } }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Workflow archived" } });
      await tx.workflowApprovalRequest.updateMany({ where: { companyId, status: "PENDING", run: { workflowId: wf.id } }, data: { status: "CANCELLED" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `workflow.${status.toLowerCase()}`, resourceType: "workflow", resourceId: wf.id, oldValue: { status: wf.status }, newValue: { status } });
    return { ok: true, status };
  });
}

export const testRunInput = z.object({
  /** Sample event data (event.data). */
  data: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}),
  entityId: z.string().max(200).optional(),
  /** Run the unpublished draft instead of the current version. */
  useDraft: z.boolean().default(true),
});

/**
 * Test run with a sample payload. Actions are real (records are created, messages sent) — the UI says so.
 * Processing starts immediately and continues in the worker if the run waits.
 */
export async function testRun(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string, raw: z.input<typeof testRunInput>) {
  const input = testRunInput.parse(raw);
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute");
  const wf = await findWorkflow(db(), organizationId, companyId, workflowId);
  if (wf.status === "ARCHIVED") throw conflict("Archived workflows cannot run", { reason: "automation_workflow_archived" });
  let definition: Definition | undefined;
  let versionId: string | null = null;
  if (input.useDraft || !wf.currentVersionId) definition = definitionOrThrow(wf.draft);
  else versionId = wf.currentVersionId;
  const def = definition ?? definitionOrThrow((await db().workflowVersion.findUniqueOrThrow({ where: { id: versionId! } })).definition);
  const id = randomUUID();
  const type = def.trigger.type === "event" ? def.trigger.event : def.trigger.type === "webhook" ? "webhook.received" : def.trigger.type === "schedule" ? "schedule.tick" : "manual";
  const event: TriggerEventData = { id: `test:${id}`, type, entityId: input.entityId || id, entityType: "test", occurredAt: new Date().toISOString(), data: input.data };
  const runId = await createRun({ workflowId: wf.id, organizationId, companyId, versionId, definition, triggerEventId: `test:${id}`, triggerType: def.trigger.type, event, depth: 0, isTest: true, startedById: ctx.actor.id });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow.test_run", resourceType: "workflow_run", resourceId: runId, newValue: { workflowId: wf.id, draft: !!definition } }));
  if (runId) await processRun(runId);
  return { id: runId };
}

// ───────────────────────────── Runs ─────────────────────────────

export interface RunFilters {
  status?: (typeof RUN_STATUSES)[number];
  workflowId?: string;
  /** Inclusive day range (YYYY-MM-DD, UTC) on the run's creation time. */
  from?: string;
  to?: string;
  /** Only real (non-test) runs, or only tests. */
  kind?: "real" | "test";
  cursor?: string;
}

export function parseRunFilters(raw: Record<string, string | string[] | undefined>): RunFilters {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const status = one("status");
  const workflowId = one("workflow");
  const cursor = one("cursor");
  const dayOf = (k: string) => {
    const v = one(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined;
  };
  const kind = one("kind");
  return {
    status: (RUN_STATUSES as readonly string[]).includes(status ?? "") ? (status as RunFilters["status"]) : undefined,
    workflowId: workflowId && isUuid(workflowId) ? workflowId : undefined,
    from: dayOf("from"),
    to: dayOf("to"),
    kind: kind === "real" || kind === "test" ? kind : undefined,
    cursor: cursor && isUuid(cursor) ? cursor : undefined,
  };
}

function runWhere(organizationId: string, companyId: string, f: RunFilters): Prisma.WorkflowRunWhereInput {
  const created: Prisma.DateTimeFilter = {};
  if (f.from) created.gte = new Date(`${f.from}T00:00:00Z`);
  if (f.to) created.lt = new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000);
  return {
    organizationId,
    companyId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.workflowId ? { workflowId: f.workflowId } : {}),
    ...(f.kind ? { isTest: f.kind === "test" } : {}),
    ...(f.from || f.to ? { createdAt: created } : {}),
  };
}

export async function listRuns(ctx: RequestContext, organizationId: string, companyId: string, f: RunFilters = {}, limit = 50) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const page = pageInput.parse({ limit, cursor: f.cursor });
  const rows = await db().workflowRun.findMany({
    where: runWhere(organizationId, companyId, f),
    orderBy: { id: "desc" },
    select: {
      id: true,
      status: true,
      triggerType: true,
      triggerEventId: true,
      depth: true,
      isTest: true,
      error: true,
      waitingFor: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      deadLetteredAt: true,
      workflow: { select: { id: true, name: true } },
      version: { select: { version: true } },
      _count: { select: { steps: true } },
    },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

export async function getRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  if (!isUuid(runId)) throw notFound("Run");
  const run = await db().workflowRun.findFirst({
    where: { id: runId, organizationId, companyId },
    include: {
      workflow: { select: { id: true, name: true, ownerId: true } },
      version: { select: { version: true, definition: true } },
      steps: { orderBy: { startedAt: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) throw notFound("Run");
  return { ...run, definition: draftOf(run.definition ?? run.version?.definition ?? null) };
}

/** Retry a FAILED or CANCELLED run from the failed step (completed steps are not repeated). */
export async function retryRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute", tx);
    if (!isUuid(runId)) throw notFound("Run");
    const run = await tx.workflowRun.findFirst({ where: { id: runId, organizationId, companyId }, select: { id: true, status: true, workflow: { select: { status: true } } } });
    if (!run) throw notFound("Run");
    if (run.workflow.status === "ARCHIVED") throw conflict("Archived workflows cannot run", { reason: "automation_workflow_archived" });
    const { count } = await tx.workflowRun.updateMany({ where: { id: runId, status: { in: ["FAILED", "CANCELLED"] } }, data: { status: "QUEUED", nextRunAt: new Date(), finishedAt: null, error: null, claimToken: null, deadLetteredAt: null } });
    if (!count) throw conflict("Only failed or cancelled runs can be retried", { reason: "automation_workflow_run_not_retryable" });
    await tx.workflowRunStep.updateMany({ where: { runId, status: "FAILED" }, data: { attempts: 0 } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow_run.retried", resourceType: "workflow_run", resourceId: runId, oldValue: { status: run.status } });
  });
  await processRun(runId);
  return { ok: true };
}

export const rerunInput = z.object({ stepId: z.string().regex(/^[a-z0-9_-]{1,40}$/) });

/**
 * Re-run a finished run from a chosen step: that step and every step after it (in definition order, branches included)
 * are cleared and executed again; earlier steps keep their outputs. Actions of the re-run steps happen again.
 */
export async function rerunFromStep(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof rerunInput>) {
  const { stepId } = rerunInput.parse(raw);
  await transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute", tx);
    if (!isUuid(runId)) throw notFound("Run");
    const run = await tx.workflowRun.findFirst({ where: { id: runId, organizationId, companyId }, select: { id: true, status: true, definition: true, version: { select: { definition: true } }, workflow: { select: { status: true } } } });
    if (!run) throw notFound("Run");
    if (run.workflow.status === "ARCHIVED") throw conflict("Archived workflows cannot run", { reason: "automation_workflow_archived" });
    if (!["FAILED", "CANCELLED", "SUCCEEDED"].includes(run.status)) throw conflict("Only finished runs can be re-run", { reason: "automation_workflow_run_not_retryable" });
    const order = flattenSteps(draftOf(run.definition ?? run.version?.definition ?? null).steps).map((s) => s.id);
    const at = order.indexOf(stepId);
    if (at < 0) throw invalid("This step is not part of the run's workflow version", { reason: "automation_workflow_step_unknown" });
    const ids = order.slice(at);
    await tx.workflowRunStep.deleteMany({ where: { runId, stepId: { in: ids } } });
    await tx.workflowApprovalRequest.deleteMany({ where: { runId, stepId: { in: ids }, status: { not: "PENDING" } } });
    await tx.workflowRun.update({ where: { id: runId }, data: { status: "QUEUED", nextRunAt: new Date(), finishedAt: null, error: null, claimToken: null, waitingFor: null, deadLetteredAt: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow_run.rerun", resourceType: "workflow_run", resourceId: runId, oldValue: { status: run.status }, newValue: { fromStep: stepId, steps: ids.length } });
  });
  await processRun(runId);
  return { ok: true };
}

/** Dead-letter list: real runs that failed permanently and were neither retried nor dismissed. */
export async function listDeadLetters(ctx: RequestContext, organizationId: string, companyId: string, f: { workflowId?: string; cursor?: string } = {}) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const page = pageInput.parse({ limit: 50, cursor: f.cursor });
  const rows = await db().workflowRun.findMany({
    where: { organizationId, companyId, status: "FAILED", deadLetteredAt: { not: null }, ...(f.workflowId ? { workflowId: f.workflowId } : {}) },
    orderBy: { id: "desc" },
    select: { id: true, error: true, createdAt: true, deadLetteredAt: true, triggerType: true, workflow: { select: { id: true, name: true, ownerId: true } }, steps: { where: { status: "FAILED" }, select: { stepId: true, stepType: true, attempts: true }, take: 1 } },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

export async function deadLetterCount(organizationId: string, companyId: string) {
  return db().workflowRun.count({ where: { organizationId, companyId, status: "FAILED", deadLetteredAt: { not: null } } });
}

/** Remove a run from the dead-letter list without running it again (it stays FAILED in the history). */
export async function dismissDeadLetter(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  return transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute", tx);
    if (!isUuid(runId)) throw notFound("Run");
    const { count } = await tx.workflowRun.updateMany({ where: { id: runId, organizationId, companyId, status: "FAILED", deadLetteredAt: { not: null } }, data: { deadLetteredAt: null } });
    if (!count) throw notFound("Run");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow_run.dismissed", resourceType: "workflow_run", resourceId: runId });
    return { ok: true };
  });
}

export async function cancelRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  return transaction(async (tx) => {
    await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute", tx);
    if (!isUuid(runId)) throw notFound("Run");
    const { count } = await tx.workflowRun.updateMany({ where: { id: runId, organizationId, companyId, status: { in: ["QUEUED", "WAITING"] } }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Cancelled by a person", nextRunAt: null } });
    if (!count) throw conflict("Only queued or waiting runs can be cancelled", { reason: "automation_workflow_run_not_cancellable" });
    await tx.workflowApprovalRequest.updateMany({ where: { runId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workflow_run.cancelled", resourceType: "workflow_run", resourceId: runId });
    return { ok: true };
  });
}

// ───────────────────────────── Approvals ─────────────────────────────

export async function listWorkflowApprovals(ctx: RequestContext, organizationId: string, companyId: string, status: "PENDING" | "DECIDED" = "PENDING") {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  return db().workflowApprovalRequest.findMany({
    where: { organizationId, companyId, ...(status === "PENDING" ? { status: "PENDING" } : { status: { not: "PENDING" } }) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { run: { select: { id: true, workflow: { select: { id: true, name: true } } } } },
  });
}

/**
 * Pending workflow approvals the viewer may decide: those naming them as an approver, plus (with workflows.execute)
 * those open to anyone. Used by the main /approvals page; needs no workflows permission for named approvers.
 */
export async function listMyWorkflowApprovals(ctx: RequestContext, organizationId: string, companyId: string) {
  const me = ctx.actor.id;
  if (!me) return [];
  const chain = await companyChain(db(), organizationId, companyId);
  const canExecute = grantsAllow(await loadGrants(db(), "USER", me), "workflows.execute", chain);
  return db().workflowApprovalRequest.findMany({
    where: { organizationId, companyId, status: "PENDING", OR: [{ approverIds: { has: me } }, ...(canExecute ? [{ approverIds: { isEmpty: true } }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { run: { select: { id: true, workflow: { select: { id: true, name: true } } } } },
  });
}

export const decideInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });

export async function decideWorkflowApproval(ctx: RequestContext, organizationId: string, companyId: string, approvalId: string, raw: z.input<typeof decideInput>) {
  const input = decideInput.parse(raw);
  const runId = await transaction(async (tx) => {
    if (!isUuid(approvalId)) throw notFound("Approval");
    const req = await tx.workflowApprovalRequest.findFirst({ where: { id: approvalId, organizationId, companyId } });
    if (!req) throw notFound("Approval");
    // Named approvers (chosen people, permission holders, the record owner) decide without needing workflow rights;
    // requests without named approvers are decided by anyone with workflows.execute.
    if (req.approverIds.length) {
      if (!req.approverIds.includes(ctx.actor.id ?? "")) throw new AppError("forbidden", "You are not an approver of this request", { reason: "automation_workflow_not_approver" });
      const member = await tx.membership.findFirst({ where: { organizationId, userId: ctx.actor.id!, status: "ACTIVE" }, select: { userId: true } });
      if (!member) throw notFound("Approval");
    } else await authorizeWorkflows(ctx, organizationId, companyId, "workflows.execute", tx);
    const { count } = await tx.workflowApprovalRequest.updateMany({
      where: { id: approvalId, status: "PENDING" },
      data: { status: input.decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.actor.id, decidedAt: new Date(), note: input.note || null },
    });
    if (!count) throw conflict("This request was already decided", { reason: "automation_workflow_approval_decided" });
    await tx.workflowRun.updateMany({ where: { id: req.runId, status: "WAITING" }, data: { status: "QUEUED", nextRunAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `workflow_approval.${input.decision === "approve" ? "approved" : "rejected"}`, resourceType: "workflow_approval", resourceId: approvalId, newValue: { runId: req.runId, note: input.note } });
    return req.runId;
  });
  await processRun(runId);
  return { ok: true };
}

// ───────────────────────────── Versions ─────────────────────────────

/** Two definitions of a workflow side by side: versions by number, or "draft". */
export async function compareVersions(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string, left: string, right: string) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const wf = await findWorkflow(db(), organizationId, companyId, workflowId);
  // B35: the version list (numbers only, newest 200) and just the two compared definitions.
  const versions = await db().workflowVersion.findMany({ where: { workflowId: wf.id }, orderBy: { version: "desc" }, take: 200, select: { version: true, createdAt: true } });
  const wanted = [left, right].filter((k) => /^\d{1,6}$/.test(k)).map(Number);
  const defs = wanted.length ? await db().workflowVersion.findMany({ where: { workflowId: wf.id, version: { in: wanted } }, select: { version: true, definition: true, createdAt: true } }) : [];
  const pick = (key: string) => {
    if (key === "draft") return { key, label: "draft", definition: draftOf(wf.draft), createdAt: wf.updatedAt };
    const v = defs.find((x) => String(x.version) === key);
    return v ? { key, label: `v${v.version}`, definition: draftOf(v.definition), createdAt: v.createdAt } : null;
  };
  return { workflow: { id: wf.id, name: wf.name, currentVersion: wf.currentVersion }, versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt })), left: pick(left), right: pick(right) };
}

// ───────────────────────────── AI drafting ─────────────────────────────

export const aiDraftInput = z.object({ description: z.string().trim().min(10).max(4000) });

/** "Describe it, AI drafts it": an automation_architect task that writes the draft of this workflow (never publishes). */
export async function requestAiDraft(ctx: RequestContext, organizationId: string, companyId: string, workflowId: string, raw: z.input<typeof aiDraftInput>) {
  const { description } = aiDraftInput.parse(raw);
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage");
  const wf = await findWorkflow(db(), organizationId, companyId, workflowId);
  return createTask(ctx, organizationId, companyId, {
    profile: "automation_architect",
    title: `Draft workflow: ${wf.name}`.slice(0, 200),
    instructions: `Design the workflow "${wf.name}" (id ${wf.id}) from this description and save it with create_workflow_draft, passing workflowId "${wf.id}" so the draft of this existing workflow is replaced (it stays unpublished until a person publishes it). Check existing workflows and connected integrations first. Description:\n\n${description}`,
    subject: { type: "workflow", id: wf.id },
  });
}

/** Counts for the module overview. */
export async function workflowOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [active, runs, failed, succeeded, pendingApprovals, deadLetters] = await Promise.all([
    db().workflow.count({ where: { organizationId, companyId, status: "ACTIVE" } }),
    db().workflowRun.count({ where: { organizationId, companyId, createdAt: { gte: since } } }),
    db().workflowRun.count({ where: { organizationId, companyId, createdAt: { gte: since }, status: "FAILED" } }),
    db().workflowRun.count({ where: { organizationId, companyId, createdAt: { gte: since }, status: "SUCCEEDED" } }),
    db().workflowApprovalRequest.count({ where: { organizationId, companyId, status: "PENDING" } }),
    deadLetterCount(organizationId, companyId),
  ]);
  const finished = failed + succeeded;
  return { active, runs, failed, successRate: finished ? Math.round((succeeded / finished) * 100) : null, pendingApprovals, deadLetters };
}
