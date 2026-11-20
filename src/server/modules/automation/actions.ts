import "server-only";
import { z, ZodError } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, isAppError, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createLead, updateLead } from "@/server/modules/crm/service";
import { createTask } from "@/server/modules/agents/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { getConnection } from "@/server/modules/integrations/connections";
import { providerFetch } from "@/server/modules/integrations/client";
import { ProviderError } from "@/server/modules/integrations/providers";
import { validateTargetUrl } from "@/server/modules/integrations/webhooks";
import { render, type Action, type EvalScope } from "./definition";

/**
 * Workflow actions. Each runs as the workflow owner (RBAC applies through the owner's context) inside the run's company.
 * External actions report success only when the provider accepted the request.
 */

export interface ActionEnv {
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  ownerId: string;
  runId: string;
  workflowId: string;
  workflowName: string;
  stepId: string;
}

export type ActionResult = { kind: "done"; output: Record<string, unknown> } | { kind: "wait"; waitingFor: "approval" | "agent_task"; output: Record<string, unknown> };

/** An error that retrying will not fix (validation, permissions, missing records, provider 4xx, not connected). */
export class PermanentError extends Error {}

const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;
const emailSchema = z.string().trim().email().max(254);
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function isPermanent(err: unknown): boolean {
  if (err instanceof PermanentError || err instanceof ZodError) return true;
  if (isAppError(err)) return !["service_unavailable", "internal_error", "rate_limited"].includes(err.code);
  if (err instanceof ProviderError) return err.status !== null && err.status >= 400 && err.status < 500 && err.status !== 429;
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ZodError) return `Invalid input: ${err.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`.slice(0, 500);
  if (err instanceof Error) return err.message.slice(0, 500);
  return "Action failed";
}

/** Render every template string of an action (arrays of ids are left as configured). */
export function renderAction(action: Action, scope: EvalScope): Action {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(action)) out[k] = typeof v === "string" && k !== "kind" ? render(v, scope) : v;
  return out as Action;
}

async function requireAt(env: ActionEnv, permission: string) {
  await requirePermission(env.ctx, permission, await companyChain(db(), env.organizationId, env.companyId));
}

/** Active members of the organization among `ids`. */
async function activeMembers(organizationId: string, ids: string[]) {
  const valid = ids.filter(isUuid);
  if (!valid.length) return [];
  const rows = await db().membership.findMany({ where: { organizationId, userId: { in: valid }, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

async function requireMember(organizationId: string, userId: string) {
  if (!isUuid(userId) || !(await activeMembers(organizationId, [userId])).length) throw new PermanentError(`User ${userId || "(empty)"} is not an active member of this organization`);
}

const href = (env: ActionEnv) => `/workflows/runs/${env.runId}`;

async function createWorkTask(env: ActionEnv, a: Extract<Action, { kind: "create_task" }>) {
  await requireAt(env, "projects.manage");
  const assigneeId = blank(a.assigneeId) ?? null;
  if (assigneeId) await requireMember(env.organizationId, assigneeId);
  return transaction(async (tx) => {
    const due = a.dueInDays !== undefined ? new Date(Date.now() + a.dueInDays * 86_400_000) : null;
    const task = await tx.workTask.create({
      data: {
        organizationId: env.organizationId,
        companyId: env.companyId,
        title: a.title.slice(0, 300),
        description: blank(a.description) ?? null,
        priority: a.priority,
        assigneeId,
        dueDate: due ? new Date(`${due.toISOString().slice(0, 10)}T00:00:00Z`) : null,
        sourceType: "workflow_run",
        sourceId: env.runId,
        createdById: env.ownerId,
      },
      select: { id: true, title: true, assigneeId: true, priority: true, dueDate: true, status: true },
    });
    await writeAudit(tx, env.ctx, { category: "TENANT", organizationId: env.organizationId, action: "work_task.created", resourceType: "work_task", resourceId: task.id, newValue: { title: task.title, source: "workflow", workflowId: env.workflowId } });
    await emitDomainEvent(tx, env.ctx, "task.created", {
      organizationId: env.organizationId,
      companyId: env.companyId,
      entityType: "work_task",
      entityId: task.id,
      data: { title: task.title, assigneeId: task.assigneeId, priority: task.priority, status: task.status, dueDate: task.dueDate, sourceType: "workflow_run" },
    });
    if (assigneeId) await notifyUsers(tx, env.organizationId, [assigneeId], "automation.task_assigned", { title: task.title, href: "/projects", companyId: env.companyId });
    return { id: task.id, title: task.title, assigneeId };
  });
}

async function createContact(env: ActionEnv, a: Extract<Action, { kind: "create_contact" }>) {
  await requireAt(env, "sales.manage");
  const email = blank(a.email) ? emailSchema.parse(a.email) : null;
  return transaction(async (tx) => {
    if (email) {
      const existing = await tx.contact.findFirst({ where: { organizationId: env.organizationId, companyId: env.companyId, emailNormalized: email.toLowerCase(), archivedAt: null }, select: { id: true } });
      if (existing) return { id: existing.id, existing: true };
    }
    const contact = await tx.contact.create({
      data: {
        organizationId: env.organizationId,
        companyId: env.companyId,
        firstName: a.firstName.slice(0, 120),
        lastName: blank(a.lastName) ?? null,
        email,
        emailNormalized: email?.toLowerCase() ?? null,
        phone: blank(a.phone) ?? null,
        title: blank(a.title) ?? null,
        customFields: { source: "workflow", workflowId: env.workflowId },
        createdById: env.ownerId,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    await writeAudit(tx, env.ctx, { category: "TENANT", organizationId: env.organizationId, action: "contact.created", resourceType: "contact", resourceId: contact.id, newValue: { ...contact, source: "workflow" } });
    await emitDomainEvent(tx, env.ctx, "contact.created", { organizationId: env.organizationId, companyId: env.companyId, entityType: "contact", entityId: contact.id, data: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, source: "workflow" } });
    return { id: contact.id, existing: false };
  });
}

/** Update one field of a work task (WorkTask is owned by the Work module; workflows change it under projects.manage). */
async function updateWorkTask(env: ActionEnv, taskId: string, field: string, value: string) {
  await requireAt(env, "projects.manage");
  if (!isUuid(taskId)) throw new PermanentError("Work task id is not valid");
  const data: Prisma.WorkTaskUpdateInput = {};
  if (field === "status") data.status = z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).parse(value.trim().toUpperCase());
  else if (field === "priority") data.priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).parse(value.trim().toUpperCase());
  else if (field === "title") data.title = z.string().trim().min(1).max(300).parse(value);
  else if (field === "description") data.description = value.trim() || null;
  else if (field === "dueDate") data.dueDate = value.trim() ? new Date(`${z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(value.trim().slice(0, 10))}T00:00:00Z`) : null;
  else if (field !== "assigneeId") throw new PermanentError(`Field ${field} cannot be set on a work task`);
  let assigneeId: string | null | undefined;
  if (field === "assigneeId") {
    assigneeId = value.trim() || null;
    if (assigneeId) await requireMember(env.organizationId, assigneeId);
  }
  return transaction(async (tx) => {
    const before = await tx.workTask.findFirst({ where: { id: taskId, organizationId: env.organizationId, companyId: env.companyId }, select: { id: true, title: true, status: true, assigneeId: true } });
    if (!before) throw notFound("Work task");
    if (data.status === "DONE" && before.status !== "DONE") data.completedAt = new Date();
    const task = await tx.workTask.update({
      where: { id: taskId },
      data: { ...data, ...(assigneeId !== undefined ? { assignee: assigneeId ? { connect: { id: assigneeId } } : { disconnect: true } } : {}) },
      select: { id: true, title: true, status: true, assigneeId: true, priority: true },
    });
    await writeAudit(tx, env.ctx, { category: "TENANT", organizationId: env.organizationId, action: "work_task.updated", resourceType: "work_task", resourceId: taskId, oldValue: before, newValue: { [field]: value, source: "workflow" } });
    if (task.status === "DONE" && before.status !== "DONE") {
      await emitDomainEvent(tx, env.ctx, "task.completed", { organizationId: env.organizationId, companyId: env.companyId, entityType: "work_task", entityId: task.id, data: { title: task.title, assigneeId: task.assigneeId, priority: task.priority, status: task.status } });
    }
    if (assigneeId && assigneeId !== before.assigneeId) await notifyUsers(tx, env.organizationId, [assigneeId], "automation.task_assigned", { title: task.title, href: "/projects", companyId: env.companyId });
    return { id: task.id, [field]: value };
  });
}

function leadPatch(field: string, value: string): Record<string, unknown> {
  const v = value.trim();
  switch (field) {
    case "stage":
      return { stage: v.toUpperCase() };
    case "ownerId":
      return { ownerId: v || null };
    case "notes":
      return { notes: v };
    case "value":
      return { value: v || null };
    case "probability":
      return { probability: v ? Number(v) : null };
    case "expectedCloseDate":
      return { expectedCloseDate: v ? v.slice(0, 10) : null };
    default:
      throw new PermanentError(`Field ${field} cannot be set on a lead`);
  }
}

async function startAiTask(env: ActionEnv, a: { profile: string; title: string; instructions: string; wait: boolean }): Promise<ActionResult> {
  const task = await createTask(env.ctx, env.organizationId, env.companyId, {
    profile: a.profile,
    title: a.title.slice(0, 200),
    instructions: `${a.instructions}\n\n(Requested by the workflow "${env.workflowName}".)`.slice(0, 8000),
    subject: { type: "workflow_run", id: env.runId },
  });
  const output = { id: task.id, status: task.status };
  return a.wait ? { kind: "wait", waitingFor: "agent_task", output } : { kind: "done", output };
}

async function notify(env: ActionEnv, a: Extract<Action, { kind: "notify" }>) {
  let ids: string[] = [];
  if (a.recipients === "owner") ids = [env.ownerId];
  else if (a.recipients === "users") ids = await activeMembers(env.organizationId, a.userIds);
  else if (a.permission) ids = await transaction((tx) => usersWithPermission(tx, env.organizationId, env.companyId, a.permission!));
  ids = await activeMembers(env.organizationId, ids);
  if (!ids.length) return { notified: 0 };
  const link = a.href && /^\/[^\s]{0,300}$/.test(a.href) ? a.href : href(env);
  const n = await transaction((tx) => notifyUsers(tx, env.organizationId, ids, "automation.notification", { title: a.title.slice(0, 300), href: link, companyId: env.companyId }));
  return { notified: n };
}

async function requestApproval(env: ActionEnv, a: Extract<Action, { kind: "request_approval" }>): Promise<ActionResult> {
  return transaction(async (tx) => {
    const existing = await tx.workflowApprovalRequest.findUnique({ where: { runId_stepId: { runId: env.runId, stepId: env.stepId } }, select: { id: true, status: true } });
    if (existing && existing.status === "PENDING") return { kind: "wait" as const, waitingFor: "approval" as const, output: { approvalId: existing.id } };
    const approverIds = await activeMembers(env.organizationId, a.approverIds);
    const req = existing
      ? await tx.workflowApprovalRequest.update({ where: { id: existing.id }, data: { status: "PENDING", decidedById: null, decidedAt: null, note: null, title: a.title, message: blank(a.message) ?? null, approverIds }, select: { id: true } })
      : await tx.workflowApprovalRequest.create({
          data: { organizationId: env.organizationId, companyId: env.companyId, runId: env.runId, stepId: env.stepId, title: a.title.slice(0, 300), message: blank(a.message)?.slice(0, 2000) ?? null, approverIds },
          select: { id: true },
        });
    const recipients = approverIds.length ? approverIds : await usersWithPermission(tx, env.organizationId, env.companyId, "workflows.execute");
    await notifyUsers(tx, env.organizationId, recipients, "automation.approval_requested", { title: a.title.slice(0, 300), href: "/workflows/approvals", companyId: env.companyId });
    return { kind: "wait" as const, waitingFor: "approval" as const, output: { approvalId: req.id } };
  });
}

async function sendSlack(env: ActionEnv, a: Extract<Action, { kind: "send_slack" }>) {
  const conn = await getConnection(env.organizationId, env.companyId, "slack");
  if (!conn?.accessToken) throw new PermanentError("Slack is not connected (Integrations → Slack)");
  const res = await providerFetch<{ ok?: boolean; error?: string; ts?: string; channel?: string }>(conn, "https://slack.com/api/chat.postMessage", { method: "POST", json: { channel: a.channel.trim().replace(/^#/, ""), text: a.text } });
  if (!res.ok || !res.data?.ok) {
    const code = res.data?.error ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500 || code === "ratelimited") throw new ProviderError(`Slack: ${code}`, res.status >= 500 ? res.status : 429);
    throw new PermanentError(`Slack rejected the message: ${code}`);
  }
  return { ts: res.data.ts ?? null, channel: res.data.channel ?? a.channel };
}

function jsonBody(raw: string | undefined, fallback: unknown): unknown {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

function httpResult(status: number, text: string) {
  if (status >= 200 && status < 300) return { status, body: text.slice(0, 2000) };
  if (status === 429 || status >= 500) throw new ProviderError(`Endpoint responded ${status}`, status);
  throw new PermanentError(`Endpoint responded ${status}: ${text.slice(0, 200)}`);
}

async function httpWebhook(env: ActionEnv, a: Extract<Action, { kind: "http_webhook" }>, scope: EvalScope) {
  const url = validateTargetUrl(a.url);
  const body = JSON.stringify(jsonBody(a.body, { event: scope.event, vars: scope.vars }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Realy-Workflows/1", "x-realy-workflow": env.workflowId, "x-realy-run": env.runId },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  return httpResult(res.status, await res.text().catch(() => ""));
}

async function customApi(env: ActionEnv, a: Extract<Action, { kind: "custom_api" }>) {
  const conn = await getConnection(env.organizationId, env.companyId, "custom_api");
  if (!conn?.accessToken) throw new PermanentError("Custom API is not connected (Integrations → Custom API)");
  const base = typeof conn.config.baseUrl === "string" ? conn.config.baseUrl.replace(/\/+$/, "") : null;
  if (!base) throw new PermanentError("Custom API base URL missing");
  const res = await providerFetch(conn, `${base}${a.path}`, { method: a.method, ...(a.method === "GET" || a.method === "DELETE" ? {} : { json: jsonBody(a.body, {}) }), retries: 2 });
  return httpResult(res.status, res.text);
}

/** Execute one (already rendered) action. */
export async function executeAction(action: Action, env: ActionEnv, scope: EvalScope): Promise<ActionResult> {
  const done = (output: Record<string, unknown>): ActionResult => ({ kind: "done", output });
  switch (action.kind) {
    case "create_lead": {
      const lead = await createLead(env.ctx, env.organizationId, env.companyId, {
        name: action.name.slice(0, 200),
        email: blank(action.email),
        phone: blank(action.phone),
        source: blank(action.source)?.slice(0, 100),
        notes: blank(action.notes),
        ownerId: blank(action.ownerId),
      });
      return done({ id: lead.id, name: lead.name });
    }
    case "create_contact":
      return done(await createContact(env, action));
    case "create_task":
      return done(await createWorkTask(env, action));
    case "update_lead": {
      if (!action.stage && !blank(action.ownerId)) throw new PermanentError("Nothing to update");
      const lead = await updateLead(env.ctx, env.organizationId, env.companyId, action.leadId.trim(), { ...(action.stage ? { stage: action.stage } : {}), ...(blank(action.ownerId) ? { ownerId: blank(action.ownerId) } : {}) });
      return done({ id: lead.id, stage: lead.stage, ownerId: lead.ownerId });
    }
    case "update_record": {
      if (action.entity === "lead") {
        const lead = await updateLead(env.ctx, env.organizationId, env.companyId, action.recordId.trim(), leadPatch(action.field, action.value) as never);
        return done({ id: lead.id, [action.field]: action.value });
      }
      return done(await updateWorkTask(env, action.recordId.trim(), action.field, action.value));
    }
    case "assign_user": {
      const userId = action.userId.trim();
      if (action.entity === "lead") {
        const lead = await updateLead(env.ctx, env.organizationId, env.companyId, action.recordId.trim(), { ownerId: userId });
        return done({ id: lead.id, ownerId: lead.ownerId });
      }
      return done(await updateWorkTask(env, action.recordId.trim(), "assigneeId", userId));
    }
    case "assign_ai_employee":
    case "generate_ai_content":
      return startAiTask(env, action);
    case "notify":
      return done(await notify(env, action));
    case "request_approval":
      return requestApproval(env, action);
    case "send_email": {
      await requireAt(env, "workflows.execute");
      const to = emailSchema.parse(action.to);
      const r = await sendPlainEmail({ to, subject: action.subject.slice(0, 300), text: action.body, template: "workflow", organizationId: env.organizationId, userId: env.ownerId });
      if (r.status === "NOT_CONFIGURED") throw new AppError("not_configured", "Email delivery is not configured (EMAIL_PROVIDER)");
      if (r.status !== "SENT") throw new ProviderError("Email provider did not accept the message");
      return done({ to, messageId: r.messageId, status: r.status });
    }
    case "send_slack":
      return done(await sendSlack(env, action));
    case "http_webhook":
      return done(await httpWebhook(env, action, scope));
    case "custom_api":
      return done(await customApi(env, action));
  }
}
