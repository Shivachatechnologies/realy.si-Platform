import "server-only";
import { db, transaction, type Prisma } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { randomToken } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { definitionSchema, evaluateAll, render, type Definition, type EvalScope, type Schedule, type Step } from "./definition";
import { errorMessage, executeAction, isPermanent, renderAction, type ActionEnv } from "./actions";

/**
 * Workflow engine.
 *  - Event consumer: matches ACTIVE workflows by trigger + company, creates runs (unique per workflow + trigger event).
 *  - Runs pin a version. Processing re-walks the step tree from the top, replaying completed steps from their stored
 *    outputs, so a run can pause (delay, approval, AI task) and resume deterministically.
 *  - Failed actions retry with exponential backoff (3 attempts) unless the error is permanent.
 *  - Loop protection: actions run with requestId "wf:<runId>:<depth>"; events they cause start runs at depth+1, and
 *    runs at depth ≥ 3 are not executed. Runs per workflow are also capped per minute.
 */

export const MAX_DEPTH = 3;
export const MAX_ATTEMPTS = 3;
const RUNS_PER_MINUTE = 30;
const CLAIM_STALE_MS = 10 * 60_000;
const AGENT_POLL_MS = 60_000;

export interface TriggerEventData {
  id: string;
  type: string;
  entityId: string;
  entityType: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

const REQUEST_ID = /^wf:([0-9a-f-]{36}):(\d+)$/;
export const workflowRequestId = (runId: string, depth: number) => `wf:${runId}:${depth}`;

/** Depth of a run started by `event`: one more than the run whose action emitted it (0 for anything else). */
async function depthOf(eventId: string): Promise<number> {
  const row = await db().event.findUnique({ where: { id: eventId }, select: { requestId: true } });
  const m = row?.requestId ? REQUEST_ID.exec(row.requestId) : null;
  return m ? Number(m[2]) + 1 : 0;
}

function eventData(event: OutboxEvent): TriggerEventData {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const raw = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : Object.fromEntries(Object.entries(payload).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)));
  return { id: event.id, type: event.type, entityId: String(payload.entityId ?? event.aggregateId), entityType: event.aggregateType, occurredAt: event.occurredAt.toISOString(), data: raw };
}

const scopeFor = (event: TriggerEventData | Record<string, unknown>): EvalScope => ({ event: event as Record<string, unknown>, vars: {}, steps: {} });

export function parseDefinition(json: Prisma.JsonValue | null | undefined): Definition {
  return definitionSchema.parse(json);
}

interface NewRun {
  workflowId: string;
  organizationId: string;
  companyId: string;
  versionId: string | null;
  definition?: Definition;
  triggerEventId: string;
  triggerType: string;
  event: TriggerEventData;
  depth: number;
  isTest?: boolean;
  startedById?: string | null;
  status?: "QUEUED" | "CANCELLED";
  error?: string;
}

/** Create a run unless one already exists for this workflow + trigger event (returns null for duplicates). */
export async function createRun(r: NewRun): Promise<string | null> {
  const run = await db().workflowRun.createManyAndReturn({
    data: [
      {
        organizationId: r.organizationId,
        companyId: r.companyId,
        workflowId: r.workflowId,
        versionId: r.versionId,
        definition: r.definition ? (r.definition as unknown as Prisma.InputJsonValue) : undefined,
        triggerEventId: r.triggerEventId,
        triggerType: r.triggerType,
        triggerData: { event: r.event } as unknown as Prisma.InputJsonValue,
        depth: r.depth,
        isTest: r.isTest ?? false,
        startedById: r.startedById ?? null,
        status: r.status ?? "QUEUED",
        error: r.error ?? null,
        nextRunAt: new Date(),
        finishedAt: r.status === "CANCELLED" ? new Date() : null,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return run[0]?.id ?? null;
}

/** Event consumer: start runs of matching active workflows. Never throws (other modules share the event job). */
export async function handleWorkflowEvent(event: OutboxEvent): Promise<number> {
  if (!event.organizationId || !event.companyId) return 0;
  try {
    const payload = (event.payload ?? {}) as { data?: Record<string, unknown> };
    const isHook = event.type === "webhook.received";
    const key = isHook ? (typeof payload.data?.hookId === "string" ? payload.data.hookId : null) : event.type;
    if (!key) return 0;
    const workflows = await db().workflow.findMany({
      where: { organizationId: event.organizationId, companyId: event.companyId, status: "ACTIVE", triggerType: isHook ? "webhook" : "event", triggerKey: key, currentVersionId: { not: null } },
      select: { id: true, currentVersionId: true },
    });
    if (!workflows.length) return 0;
    const depth = await depthOf(event.id);
    const data = eventData(event);
    let started = 0;
    for (const wf of workflows) {
      const version = await db().workflowVersion.findUnique({ where: { id: wf.currentVersionId! }, select: { id: true, definition: true } });
      if (!version) continue;
      const def = parseDefinition(version.definition);
      if (!evaluateAll(def.trigger.filters, "all", scopeFor(data))) continue;
      const base = { workflowId: wf.id, organizationId: event.organizationId, companyId: event.companyId, versionId: version.id, triggerEventId: event.id, triggerType: def.trigger.type, event: data, depth };
      if (depth >= MAX_DEPTH) {
        await createRun({ ...base, status: "CANCELLED", error: `Loop protection: this event was caused by a workflow chain ${depth} levels deep; the run was not executed.` });
        continue;
      }
      const recent = await db().workflowRun.count({ where: { workflowId: wf.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });
      if (recent >= RUNS_PER_MINUTE) {
        await createRun({ ...base, status: "CANCELLED", error: `Rate limit: more than ${RUNS_PER_MINUTE} runs of this workflow in one minute.` });
        continue;
      }
      const runId = await createRun(base);
      if (runId) {
        started++;
        await processRun(runId);
      }
    }
    return started;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, eventId: event.id, type: event.type }, "workflow event handling failed");
    return 0;
  }
}

type WalkOutcome =
  | { kind: "completed" }
  | { kind: "stopped"; stepId: string }
  | { kind: "wait"; waitingFor: string; until: Date | null }
  | { kind: "retry"; at: Date; error: string }
  | { kind: "fail"; error: string; cancelled?: boolean };

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
const asObj = (v: Prisma.JsonValue | null | undefined): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Claim and process one run (no-op if another worker holds it or it is not due). */
export async function processRun(runId: string): Promise<string | null> {
  const token = randomToken(16);
  const now = new Date();
  const claimed = await db().workflowRun.updateMany({
    where: {
      id: runId,
      OR: [
        { status: { in: ["QUEUED", "WAITING"] }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }], claimToken: null },
        { status: "RUNNING", claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      ],
    },
    data: { status: "RUNNING", claimToken: token, claimedAt: now },
  });
  if (!claimed.count) return null;
  const run = await db().workflowRun.findUniqueOrThrow({ where: { id: runId }, include: { workflow: { select: { id: true, name: true, ownerId: true, status: true } }, version: { select: { definition: true } } } });
  if (!run.startedAt) await db().workflowRun.update({ where: { id: run.id }, data: { startedAt: now } });

  const finish = async (data: Prisma.WorkflowRunUpdateManyMutationInput) => {
    await db().workflowRun.updateMany({ where: { id: run.id, claimToken: token }, data: { ...data, claimToken: null } });
  };

  let outcome: WalkOutcome;
  try {
    if (run.workflow.status === "ARCHIVED") outcome = { kind: "fail", error: "The workflow was archived", cancelled: true };
    else {
      const def = parseDefinition(run.definition ?? run.version?.definition);
      const ctx = userContext(run.workflow.ownerId, { requestId: workflowRequestId(run.id, run.depth) });
      // The owner must still be allowed to execute workflows here; their permissions govern every action.
      const allowed = await can(ctx, "workflows.execute", await companyChain(db(), run.organizationId, run.companyId));
      if (!allowed) outcome = { kind: "fail", error: "The workflow owner no longer has permission to execute workflows in this company" };
      else {
        const rows = await db().workflowRunStep.findMany({ where: { runId: run.id } });
        const steps = new Map(rows.map((r) => [r.stepId, r]));
        const event = asObj(asObj(run.triggerData).event as Prisma.JsonValue);
        const scope: EvalScope = { event, vars: {}, steps: {} };
        for (const v of def.variables) scope.vars[v.name] = render(v.value, scope);
        const env: Omit<ActionEnv, "stepId"> = { ctx, organizationId: run.organizationId, companyId: run.companyId, ownerId: run.workflow.ownerId, runId: run.id, workflowId: run.workflowId, workflowName: run.workflow.name };
        outcome = await walk(def.steps, { runId: run.id, organizationId: run.organizationId, companyId: run.companyId, steps, scope, env });
      }
    }
  } catch (err) {
    logger.error({ runId, err: err instanceof Error ? err.message : err }, "workflow run crashed");
    outcome = { kind: "fail", error: errorMessage(err) };
  }

  switch (outcome.kind) {
    case "completed":
    case "stopped":
      await finish({ status: "SUCCEEDED", finishedAt: new Date(), nextRunAt: null, waitingFor: null, error: null });
      return "SUCCEEDED";
    case "wait":
      await finish({ status: "WAITING", waitingFor: outcome.waitingFor, nextRunAt: outcome.until });
      return "WAITING";
    case "retry":
      await finish({ status: "QUEUED", nextRunAt: outcome.at, waitingFor: null, error: outcome.error });
      return "QUEUED";
    case "fail": {
      await finish({ status: outcome.cancelled ? "CANCELLED" : "FAILED", finishedAt: new Date(), nextRunAt: null, waitingFor: null, error: outcome.error.slice(0, 1000) });
      if (!outcome.cancelled && !run.isTest) {
        await transaction((tx) => notifyUsers(tx, run.organizationId, [run.workflow.ownerId], "automation.run_failed", { title: run.workflow.name, href: `/workflows/runs/${run.id}`, companyId: run.companyId })).catch(() => undefined);
      }
      return outcome.cancelled ? "CANCELLED" : "FAILED";
    }
  }
}

interface WalkState {
  runId: string;
  organizationId: string;
  companyId: string;
  steps: Map<string, Prisma.WorkflowRunStepGetPayload<object>>;
  scope: EvalScope;
  env: Omit<ActionEnv, "stepId">;
}

async function saveStep(s: WalkState, step: Step, data: { status: "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "SKIPPED"; input?: unknown; output?: unknown; error?: string | null; attempts?: number; finished?: boolean }) {
  const fields = {
    status: data.status,
    ...(data.input !== undefined ? { input: data.input as Prisma.InputJsonValue } : {}),
    ...(data.output !== undefined ? { output: data.output as Prisma.InputJsonValue } : {}),
    ...(data.error !== undefined ? { error: data.error } : {}),
    ...(data.attempts !== undefined ? { attempts: data.attempts } : {}),
    finishedAt: data.finished ? new Date() : null,
  };
  const row = await db().workflowRunStep.upsert({
    where: { runId_stepId: { runId: s.runId, stepId: step.id } },
    create: { organizationId: s.organizationId, companyId: s.companyId, runId: s.runId, stepId: step.id, stepType: step.type === "action" ? `action:${step.action.kind}` : step.type, ...fields },
    update: fields,
  });
  s.steps.set(step.id, row);
  return row;
}

/** Re-apply a completed step's effect on the scope (variables, step outputs). */
function replay(s: WalkState, step: Step, output: Record<string, unknown>) {
  if (step.type === "set_variable") s.scope.vars[step.name] = output.value;
  if (step.type === "action") s.scope.steps[step.id] = output;
}

async function walk(list: Step[], s: WalkState): Promise<WalkOutcome> {
  for (const step of list) {
    const row = s.steps.get(step.id);
    const output = asObj(row?.output);

    if (row && (row.status === "SUCCEEDED" || row.status === "SKIPPED")) {
      replay(s, step, output);
      if (step.type === "condition" && output.passed === false) return { kind: "stopped", stepId: step.id };
      if (step.type === "branch") {
        const r = await walk(output.branch === "then" ? step.then : step.else, s);
        if (r.kind !== "completed") return r;
      }
      continue;
    }

    if (row?.status === "WAITING") {
      const r = await resumeWaiting(s, step, row.stepType, output);
      if (r) return r;
      continue;
    }

    switch (step.type) {
      case "condition": {
        const passed = evaluateAll(step.conditions, step.match, s.scope);
        await saveStep(s, step, { status: "SUCCEEDED", input: { conditions: step.conditions, match: step.match }, output: { passed }, finished: true });
        if (!passed) return { kind: "stopped", stepId: step.id };
        break;
      }
      case "branch": {
        const passed = evaluateAll(step.conditions, step.match, s.scope);
        await saveStep(s, step, { status: "SUCCEEDED", input: { conditions: step.conditions, match: step.match }, output: { branch: passed ? "then" : "else" }, finished: true });
        const r = await walk(passed ? step.then : step.else, s);
        if (r.kind !== "completed") return r;
        break;
      }
      case "set_variable": {
        const value = render(step.value, s.scope);
        s.scope.vars[step.name] = value;
        await saveStep(s, step, { status: "SUCCEEDED", input: { name: step.name, template: step.value }, output: { value }, finished: true });
        break;
      }
      case "delay": {
        const resumeAt = new Date(Date.now() + step.amount * UNIT_MS[step.unit]);
        await saveStep(s, step, { status: "WAITING", input: { amount: step.amount, unit: step.unit }, output: { resumeAt: resumeAt.toISOString() } });
        return { kind: "wait", waitingFor: "delay", until: resumeAt };
      }
      case "action": {
        const attempts = (row?.attempts ?? 0) + 1;
        const rendered = renderAction(step.action, s.scope);
        await saveStep(s, step, { status: "RUNNING", input: rendered, attempts, error: null });
        try {
          const result = await executeAction(rendered, { ...s.env, stepId: step.id }, s.scope);
          if (result.kind === "wait") {
            await saveStep(s, step, { status: "WAITING", output: result.output });
            return { kind: "wait", waitingFor: result.waitingFor, until: result.waitingFor === "agent_task" ? new Date(Date.now() + AGENT_POLL_MS) : null };
          }
          await saveStep(s, step, { status: "SUCCEEDED", output: result.output, finished: true });
          s.scope.steps[step.id] = result.output;
        } catch (err) {
          const error = errorMessage(err);
          await saveStep(s, step, { status: "FAILED", error, finished: true });
          if (isPermanent(err) || attempts >= MAX_ATTEMPTS) return { kind: "fail", error: `Step ${step.id}: ${error}` };
          return { kind: "retry", at: new Date(Date.now() + 30_000 * 2 ** (attempts - 1)), error: `Step ${step.id} attempt ${attempts} failed: ${error}` };
        }
        break;
      }
    }
  }
  return { kind: "completed" };
}

/** A WAITING step: resume it when its condition is met, or keep the run waiting. Returns null to continue walking. */
async function resumeWaiting(s: WalkState, step: Step, stepType: string, output: Record<string, unknown>): Promise<WalkOutcome | null> {
  if (step.type === "delay") {
    const at = new Date(String(output.resumeAt ?? 0));
    if (Date.now() < at.getTime()) return { kind: "wait", waitingFor: "delay", until: at };
    await saveStep(s, step, { status: "SUCCEEDED", finished: true });
    return null;
  }
  if (step.type !== "action") return null;
  if (stepType === "action:request_approval" && typeof output.approvalId === "string") {
    const req = await db().workflowApprovalRequest.findUnique({ where: { id: output.approvalId }, select: { status: true, decidedById: true, note: true } });
    if (!req || req.status === "PENDING") return { kind: "wait", waitingFor: "approval", until: null };
    if (req.status === "APPROVED") {
      const out = { ...output, approved: true, decidedById: req.decidedById, note: req.note ?? "" };
      await saveStep(s, step, { status: "SUCCEEDED", output: out, finished: true });
      s.scope.steps[step.id] = out;
      return null;
    }
    await saveStep(s, step, { status: "FAILED", output: { ...output, approved: false, note: req.note ?? "" }, error: req.status === "REJECTED" ? "Rejected by approver" : "Approval cancelled", finished: true });
    return { kind: "fail", error: req.status === "REJECTED" ? `Step ${step.id}: rejected by approver${req.note ? ` (${req.note})` : ""}` : `Step ${step.id}: approval cancelled`, cancelled: true };
  }
  if (typeof output.id === "string" && (step.action.kind === "assign_ai_employee" || step.action.kind === "generate_ai_content")) {
    const task = await db().agentTask.findFirst({ where: { id: output.id, companyId: s.companyId }, select: { status: true, output: true, errorMessage: true } });
    if (!task) return { kind: "fail", error: `Step ${step.id}: AI task not found` };
    if (task.status === "QUEUED" || task.status === "RUNNING") return { kind: "wait", waitingFor: "agent_task", until: new Date(Date.now() + AGENT_POLL_MS) };
    if (task.status === "COMPLETED") {
      const out = { id: output.id, status: task.status, output: (task.output ?? "").slice(0, 20_000) };
      await saveStep(s, step, { status: "SUCCEEDED", output: out, finished: true });
      s.scope.steps[step.id] = out;
      return null;
    }
    await saveStep(s, step, { status: "FAILED", error: `AI task ${task.status.toLowerCase()}${task.errorMessage ? `: ${task.errorMessage}` : ""}`, finished: true });
    return { kind: "fail", error: `Step ${step.id}: AI task ${task.status.toLowerCase()}` };
  }
  return null;
}

/** Periodic job: process due queued/waiting runs and recover stale claims. */
export async function processDueRuns(limit = 25): Promise<number> {
  const now = new Date();
  const due = await db().workflowRun.findMany({
    where: {
      OR: [
        { status: { in: ["QUEUED", "WAITING"] }, nextRunAt: { lte: now }, claimToken: null },
        { status: "RUNNING", claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let n = 0;
  for (const r of due) if (await processRun(r.id)) n++;
  return n;
}

// ───────────────────────────── Schedules ─────────────────────────────

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday };
}

/** The current schedule slot if it is due (its time has passed), else null. Slots are stable keys: one run per slot. */
export function currentSlot(schedule: Schedule, now: Date, timeZone: string): string | null {
  if (schedule.kind === "interval") return `i${schedule.minutes}:${Math.floor(now.getTime() / (schedule.minutes * 60_000))}`;
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const p = localParts(now, tz);
  if (p.time < schedule.time) return null;
  if (schedule.kind === "daily") return `d:${p.day}`;
  return p.weekday === schedule.day ? `w:${p.day}` : null;
}

/** Periodic job: start schedule-triggered runs, once per slot. */
export async function fireSchedules(): Promise<number> {
  const workflows = await db().workflow.findMany({
    where: { status: "ACTIVE", triggerType: "schedule", currentVersionId: { not: null } },
    select: { id: true, organizationId: true, companyId: true, currentVersionId: true, lastScheduleSlot: true, company: { select: { timezone: true } } },
    take: 500,
  });
  const now = new Date();
  let fired = 0;
  for (const wf of workflows) {
    try {
      const version = await db().workflowVersion.findUnique({ where: { id: wf.currentVersionId! }, select: { id: true, definition: true } });
      if (!version) continue;
      const def = parseDefinition(version.definition);
      if (def.trigger.type !== "schedule") continue;
      const slot = currentSlot(def.trigger.schedule, now, wf.company.timezone);
      if (!slot || slot === wf.lastScheduleSlot) continue;
      const { count } = await db().workflow.updateMany({ where: { id: wf.id, lastScheduleSlot: wf.lastScheduleSlot }, data: { lastScheduleSlot: slot } });
      if (!count) continue;
      const event: TriggerEventData = { id: `schedule:${slot}`, type: "schedule.tick", entityId: wf.id, entityType: "workflow", occurredAt: now.toISOString(), data: { slot } };
      const runId = await createRun({ workflowId: wf.id, organizationId: wf.organizationId, companyId: wf.companyId, versionId: version.id, triggerEventId: `schedule:${slot}`, triggerType: "schedule", event, depth: 0 });
      if (runId) {
        fired++;
        await processRun(runId);
      }
    } catch (err) {
      logger.error({ workflowId: wf.id, err: err instanceof Error ? err.message : err }, "workflow schedule failed");
    }
  }
  return fired;
}
