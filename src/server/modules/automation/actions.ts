import "server-only";
import { z, ZodError } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, isAppError, notFound } from "@/server/core/errors";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createLead, updateLead } from "@/server/modules/crm/service";
import { createContact } from "@/server/modules/crm/contacts";
import { createAccount } from "@/server/modules/crm/accounts";
import { createDeal, moveDealStage, updateDeal } from "@/server/modules/crm/deals";
import { pickAutoOwner } from "@/server/modules/crm/automation";
import { createWorkTask, updateWorkTask } from "@/server/modules/work/tasks";
import { addProjectMember, createWorkProject } from "@/server/modules/work/projects";
import { startChecklist } from "@/server/modules/hr/onboarding";
import { createInvoice } from "@/server/modules/finance/billing";
import { createMeeting } from "@/server/modules/comms/meetings";
import { updateTicket } from "@/server/modules/support/tickets";
import { createTask } from "@/server/modules/agents/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { getConnection } from "@/server/modules/integrations/connections";
import { providerFetch } from "@/server/modules/integrations/client";
import { ProviderError } from "@/server/modules/integrations/providers";
import { validateTargetUrl } from "@/server/modules/integrations/webhooks";
import { render, type Action, type EvalScope } from "./definition";

/**
 * Workflow actions. Each runs as the workflow owner (RBAC applies through the owner's context) inside the run's company.
 * Records are created and changed through their owning module's services, so that module's validation, audit log,
 * domain events and notifications apply exactly as when a person does it.
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
const blank = (v: string | undefined | null) => (v && v.trim() ? v.trim() : undefined);
const DAY_MS = 86_400_000;
const dayIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

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

/** Active members of the organization among `ids` (input order kept). */
async function activeMembers(organizationId: string, ids: string[]) {
  const valid = [...new Set(ids.filter(isUuid))];
  if (!valid.length) return [];
  const rows = await db().membership.findMany({ where: { organizationId, userId: { in: valid }, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { userId: true } });
  const ok = new Set(rows.map((r) => r.userId));
  return valid.filter((id) => ok.has(id));
}

/** Ids from a rendered "a, b c" list (variables may render empty). */
const idList = (raw: string | undefined) => (raw ?? "").split(/[\s,;]+/).filter(isUuid);

const href = (env: ActionEnv) => `/workflows/runs/${env.runId}`;
const conflictIds = (err: unknown) => (isAppError(err) && err.code === "conflict" && Array.isArray(err.details?.ids) ? (err.details.ids as string[]) : null);

// ───────────────────────────── Records (through owner services) ─────────────────────────────

async function createContactAction(env: ActionEnv, a: Extract<Action, { kind: "create_contact" }>) {
  const email = blank(a.email) ? emailSchema.parse(a.email) : undefined;
  try {
    const c = await createContact(env.ctx, env.organizationId, env.companyId, {
      firstName: a.firstName.slice(0, 100),
      lastName: blank(a.lastName)?.slice(0, 100),
      email,
      phone: blank(a.phone)?.slice(0, 40),
      title: blank(a.title)?.slice(0, 150),
      accountId: blank(a.accountId),
      ownerId: blank(a.ownerId),
    });
    return { id: c.id, existing: false };
  } catch (err) {
    const ids = conflictIds(err);
    if (ids?.[0]) return { id: ids[0], existing: true };
    throw err;
  }
}

async function createAccountAction(env: ActionEnv, a: Extract<Action, { kind: "create_account" }>) {
  try {
    const acc = await createAccount(env.ctx, env.organizationId, env.companyId, {
      name: a.name.slice(0, 200),
      type: a.type,
      email: blank(a.email) ? emailSchema.parse(a.email) : undefined,
      phone: blank(a.phone)?.slice(0, 40),
      website: blank(a.website)?.slice(0, 300),
      source: blank(a.source)?.slice(0, 100),
      ownerId: blank(a.ownerId),
    });
    return { id: acc.id, name: acc.name, existing: false };
  } catch (err) {
    const ids = conflictIds(err);
    if (ids?.[0]) return { id: ids[0], name: a.name, existing: true };
    throw err;
  }
}

async function createTaskAction(env: ActionEnv, a: Extract<Action, { kind: "create_task" }>) {
  const description = blank(a.description);
  const task = await createWorkTask(env.ctx, env.organizationId, env.companyId, {
    title: a.title.slice(0, 300),
    description: `${description ? `${description}\n\n` : ""}(Created by the workflow "${env.workflowName}".)`.slice(0, 20_000),
    assigneeId: blank(a.assigneeId) ?? null,
    projectId: blank(a.projectId) ?? null,
    priority: a.priority,
    dueDate: a.dueInDays !== undefined ? dayIn(a.dueInDays) : null,
  });
  return { id: task.id, title: task.title, assigneeId: task.assigneeId, projectId: task.projectId };
}

/** Update one field of a work task through the Work module. */
async function updateTaskField(env: ActionEnv, taskId: string, field: string, value: string) {
  if (!isUuid(taskId)) throw new PermanentError("Work task id is not valid");
  const v = value.trim();
  let patch: Parameters<typeof updateWorkTask>[4];
  if (field === "status") patch = { status: v.toUpperCase() as "TODO" };
  else if (field === "priority") patch = { priority: v.toUpperCase() as "LOW" };
  else if (field === "title") patch = { title: v };
  else if (field === "description") patch = { description: v || null };
  else if (field === "dueDate") patch = { dueDate: v ? v.slice(0, 10) : null };
  else if (field === "assigneeId") patch = { assigneeId: v || null };
  else throw new PermanentError(`Field ${field} cannot be set on a work task`);
  const task = await updateWorkTask(env.ctx, env.organizationId, env.companyId, taskId, patch);
  return { id: task.id, [field]: value };
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

/** Assign a record to a person through its owning module (leads, deals, work tasks, support tickets). */
async function assignTo(env: ActionEnv, entity: "lead" | "work_task" | "deal" | "ticket", recordId: string, userId: string) {
  const id = recordId.trim();
  if (!isUuid(id)) throw new PermanentError(`The ${entity} id is not valid`);
  if (!isUuid(userId)) throw new PermanentError(`User ${userId || "(empty)"} is not valid`);
  switch (entity) {
    case "lead": {
      const lead = await updateLead(env.ctx, env.organizationId, env.companyId, id, { ownerId: userId });
      return { id: lead.id, userId: lead.ownerId };
    }
    case "deal": {
      const deal = await updateDeal(env.ctx, env.organizationId, env.companyId, id, { ownerId: userId });
      return { id: deal.id, userId: deal.ownerId };
    }
    case "ticket":
      await updateTicket(env.ctx, env.organizationId, env.companyId, id, { assigneeId: userId });
      return { id, userId };
    case "work_task":
      await updateTaskField(env, id, "assigneeId", userId);
      return { id, userId };
  }
}

/** Atomically advance a named round-robin cursor of this workflow; returns the index to use. */
async function nextIndex(env: ActionEnv, key: string, size: number) {
  const row = await db().workflowCounter.upsert({
    where: { workflowId_key: { workflowId: env.workflowId, key: key.slice(0, 500) } },
    create: { organizationId: env.organizationId, companyId: env.companyId, workflowId: env.workflowId, key: key.slice(0, 500), value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return (row.value - 1) % size;
}

async function permissionPool(env: ActionEnv, permission: string) {
  const ids = await transaction((tx) => usersWithPermission(tx, env.organizationId, env.companyId, permission));
  return activeMembers(env.organizationId, [...ids].sort());
}

async function roundRobin(env: ActionEnv, a: Extract<Action, { kind: "assign_round_robin" }>) {
  let userId: string | null = null;
  let via: string = a.pool;
  if (a.pool === "crm_rules") {
    if (a.entity !== "lead") throw new PermanentError("CRM assignment rules only apply to leads");
    const leadId = a.recordId.trim();
    if (!isUuid(leadId)) throw new PermanentError("The lead id is not valid");
    await requireAt(env, "sales.manage");
    const lead = await db().lead.findFirst({ where: { id: leadId, organizationId: env.organizationId, companyId: env.companyId }, select: { source: true, territory: true } });
    if (!lead) throw notFound("Lead");
    const chain = await companyChain(db(), env.organizationId, env.companyId);
    const pick = await transaction((tx) => pickAutoOwner(tx, env.organizationId, env.companyId, chain, lead));
    userId = pick?.ownerId ?? null;
    if (!userId && a.fallbackPermission) {
      const pool = await permissionPool(env, a.fallbackPermission);
      if (pool.length) userId = pool[await nextIndex(env, `rr:${a.entity}:permission:${a.fallbackPermission}`, pool.length)]!;
      via = "fallback_permission";
    }
  } else {
    const pool = a.pool === "users" ? await activeMembers(env.organizationId, a.userIds) : await permissionPool(env, a.permission ?? "");
    if (pool.length) userId = pool[await nextIndex(env, `rr:${a.entity}:${a.pool}:${a.pool === "users" ? a.userIds.join(",") : a.permission}`, pool.length)]!;
  }
  if (!userId) throw new PermanentError("Nobody is available to assign (the pool of people is empty)");
  return { ...(await assignTo(env, a.entity, a.recordId, userId)), via };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Read a record so later steps can use its fields ({{steps.<id>.name}}, {{steps.<id>.ownerId}}...). Requires read access. */
async function loadRecord(env: ActionEnv, a: Extract<Action, { kind: "load_record" }>): Promise<Record<string, unknown>> {
  const id = a.recordId.trim();
  if (!isUuid(id)) throw new PermanentError(`The ${a.entity} id is not valid`);
  const where = { id, organizationId: env.organizationId, companyId: env.companyId };
  const missing = (): never => {
    throw notFound(a.entity);
  };
  switch (a.entity) {
    case "account": {
      await requireAt(env, "sales.read");
      const r = (await db().account.findFirst({ where, select: { id: true, name: true, ownerId: true, email: true, type: true, domain: true, phone: true } })) ?? missing();
      return { ...r, accountId: r.id };
    }
    case "contact": {
      await requireAt(env, "sales.read");
      const r = (await db().contact.findFirst({ where, select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true, accountId: true } })) ?? missing();
      return { ...r, name: [r.firstName, r.lastName].filter(Boolean).join(" ") };
    }
    case "lead": {
      await requireAt(env, "sales.read");
      return (await db().lead.findFirst({ where, select: { id: true, name: true, email: true, phone: true, ownerId: true, stage: true, source: true } })) ?? missing();
    }
    case "deal": {
      await requireAt(env, "sales.read");
      const r = (await db().crmDeal.findFirst({ where, select: { id: true, name: true, ownerId: true, accountId: true, contactId: true, status: true, amountMinor: true, currency: true } })) ?? missing();
      return { ...r, amountMinor: r.amountMinor.toString() };
    }
    case "project": {
      await requireAt(env, "projects.read");
      const r = (await db().project.findFirst({ where, select: { id: true, name: true, ownerId: true, status: true, dueDate: true } })) ?? missing();
      return { ...r, dueDate: iso(r.dueDate) };
    }
    case "objective": {
      await requireAt(env, "objectives.read");
      const r = (await db().objective.findFirst({ where, select: { id: true, title: true, description: true, status: true, targetDate: true, createdById: true } })) ?? missing();
      return { ...r, name: r.title, ownerId: r.createdById, targetDate: iso(r.targetDate) };
    }
    case "employee": {
      await requireAt(env, "hr.read");
      const r = (await db().employee.findFirst({ where, select: { id: true, firstName: true, lastName: true, email: true, title: true, userId: true, managerId: true, departmentId: true, startDate: true } })) ?? missing();
      const manager = r.managerId ? await db().employee.findFirst({ where: { id: r.managerId, companyId: env.companyId }, select: { userId: true } }) : null;
      return { ...r, name: [r.firstName, r.lastName].filter(Boolean).join(" "), ownerId: manager?.userId ?? null, managerUserId: manager?.userId ?? null, startDate: iso(r.startDate) };
    }
    case "candidate": {
      await requireAt(env, "hr.read");
      const r = (await db().hrCandidate.findFirst({ where, select: { id: true, firstName: true, lastName: true, email: true, phone: true, jobId: true, stage: true } })) ?? missing();
      return { ...r, name: [r.firstName, r.lastName].filter(Boolean).join(" ") };
    }
    case "ticket": {
      await requireAt(env, "support.read");
      const r = (await db().supportTicket.findFirst({ where, select: { id: true, number: true, subject: true, priority: true, status: true, assigneeId: true, accountId: true } })) ?? missing();
      return { ...r, name: r.subject, ownerId: r.assigneeId };
    }
    case "invoice": {
      await requireAt(env, "finance.read");
      const r = (await db().invoice.findFirst({ where, select: { id: true, number: true, status: true, accountId: true, totalMinor: true, currency: true, dueDate: true } })) ?? missing();
      const acc = r.accountId ? await db().account.findFirst({ where: { id: r.accountId, companyId: env.companyId }, select: { ownerId: true, name: true } }) : null;
      return { ...r, name: r.number, totalMinor: r.totalMinor.toString(), dueDate: iso(r.dueDate), ownerId: acc?.ownerId ?? null, accountName: acc?.name ?? null };
    }
  }
}

async function createProjectAction(env: ActionEnv, a: Extract<Action, { kind: "create_project" }>) {
  const ownerId = blank(a.ownerId);
  if (ownerId && !isUuid(ownerId)) throw new PermanentError(`Project owner ${ownerId} is not a valid user id`);
  const members = await activeMembers(env.organizationId, [...a.memberIds, ...idList(a.extraMemberIds)]);
  const project = await createWorkProject(env.ctx, env.organizationId, env.companyId, {
    name: a.name.slice(0, 120),
    description: blank(a.description)?.slice(0, 5000),
    template: blank(a.template),
    ownerId: ownerId ?? null,
    memberIds: members.filter((m) => m !== ownerId),
    startDate: a.startInDays !== undefined ? dayIn(a.startInDays) : null,
    dueDate: a.dueInDays !== undefined ? dayIn(a.dueInDays) : null,
  });
  return { id: project.id, name: project.name, ownerId: project.ownerId, members: members.length };
}

async function addMembersAction(env: ActionEnv, a: Extract<Action, { kind: "add_project_members" }>) {
  const projectId = a.projectId.trim();
  if (!isUuid(projectId)) throw new PermanentError("The project id is not valid");
  const users = await activeMembers(env.organizationId, [...a.userIds, ...idList(a.extraUserIds)]);
  if (!users.length) return { id: projectId, added: 0 };
  for (const userId of users) await addProjectMember(env.ctx, env.organizationId, env.companyId, projectId, { userId, role: blank(a.role)?.slice(0, 80) });
  return { id: projectId, added: users.length, userIds: users };
}

async function onboardingAction(env: ActionEnv, a: Extract<Action, { kind: "start_onboarding" }>) {
  const employeeId = a.employeeId.trim();
  if (!isUuid(employeeId)) throw new PermanentError("The employee id is not valid");
  try {
    const list = await startChecklist(env.ctx, env.organizationId, env.companyId, { employeeId, kind: a.checklist, templateId: blank(a.templateId) });
    return { id: list.id, existing: false };
  } catch (err) {
    // Already started (e.g. HR started it by hand): the step's goal is met.
    if (isAppError(err) && err.details?.reason === "hr_checklist_open" && typeof err.details.checklistId === "string") return { id: err.details.checklistId, existing: true };
    throw err;
  }
}

async function invoiceAction(env: ActionEnv, a: Extract<Action, { kind: "create_invoice" }>) {
  const accountId = a.accountId.trim();
  if (!isUuid(accountId)) throw new PermanentError("The customer (account) id is not valid");
  const inv = await createInvoice(env.ctx, env.organizationId, env.companyId, {
    accountId,
    issueDate: dayIn(0),
    dueDate: a.dueInDays !== undefined ? dayIn(a.dueInDays) : undefined,
    notes: blank(a.notes),
    lines: [{ description: a.description.slice(0, 500), quantity: blank(a.quantity) ?? "1", unitPrice: a.unitPrice.trim() }],
  });
  return { id: inv.id, number: inv.number, status: inv.status, totalMinor: inv.totalMinor.toString(), currency: inv.currency };
}

async function meetingAction(env: ActionEnv, a: Extract<Action, { kind: "create_meeting" }>) {
  let start: Date;
  const fromVar = blank(a.startsAt);
  if (fromVar) {
    const t = Date.parse(fromVar);
    if (!Number.isFinite(t)) throw new PermanentError(`Meeting start "${fromVar}" is not a date-time`);
    start = new Date(t);
  } else {
    // Rounded up to the next quarter hour.
    const q = 15 * 60_000;
    start = new Date(Math.ceil((Date.now() + a.startInHours * 3_600_000) / q) * q);
  }
  const end = new Date(start.getTime() + a.durationMinutes * 60_000);
  const attendeeIds = await activeMembers(env.organizationId, [...a.attendeeIds, ...idList(a.extraAttendeeIds)]);
  const m = await createMeeting(env.ctx, env.organizationId, env.companyId, {
    title: a.title.slice(0, 200),
    agenda: blank(a.agenda)?.slice(0, 10_000),
    location: blank(a.location)?.slice(0, 300),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    attendeeIds,
  });
  return { id: m.id, startsAt: m.startsAt.toISOString(), attendees: attendeeIds.length };
}

// ───────────────────────────── AI ─────────────────────────────

async function startAiTask(env: ActionEnv, input: { profile?: string; aiEmployeeId?: string; title: string; instructions: string }, wait: boolean): Promise<ActionResult> {
  const task = await createTask(env.ctx, env.organizationId, env.companyId, {
    ...(input.aiEmployeeId ? { aiEmployeeId: input.aiEmployeeId } : { profile: input.profile }),
    title: input.title.slice(0, 200),
    instructions: `${input.instructions}\n\n(Requested by the workflow "${env.workflowName}".)`.slice(0, 8000),
    subject: { type: "workflow_run", id: env.runId },
  });
  const output = { id: task.id, status: task.status };
  return wait ? { kind: "wait", waitingFor: "agent_task", output } : { kind: "done", output };
}

async function decomposeGoal(env: ActionEnv, a: Extract<Action, { kind: "decompose_goal" }>): Promise<ActionResult> {
  const objective = await loadRecord(env, { kind: "load_record", entity: "objective", recordId: a.objectiveId });
  const instructions = [
    `Decompose the company objective "${String(objective.title)}" (id ${String(objective.id)}) into an execution plan.`,
    objective.description ? `Objective description: ${String(objective.description)}` : "",
    objective.targetDate ? `Target date: ${String(objective.targetDate).slice(0, 10)}.` : "",
    "Read the objective and its existing milestones with read_objectives, and the current numbers with read_company_kpis. Propose 3-6 milestones with target dates, the projects that deliver each milestone (name, owner role, scope) and the first tasks of each project (title, owner role, due date). Flag risks and dependencies. Delegate research or drafting to the right AI employee where useful. Present the plan for the objective owner to review; do not claim anything was created that you did not create with a tool.",
    blank(a.guidance) ? `Guidance from the workflow: ${a.guidance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return startAiTask(env, { profile: "ai_ceo", title: `Decompose objective: ${String(objective.title)}`, instructions }, a.wait);
}

// ───────────────────────────── People & approvals ─────────────────────────────

async function notify(env: ActionEnv, a: Extract<Action, { kind: "notify" }>) {
  let ids: string[] = [];
  if (a.recipients === "owner") ids = [env.ownerId];
  else if (a.recipients === "users") ids = a.userIds;
  else if (a.recipients === "field") ids = idList(a.userField);
  else if (a.permission) ids = await transaction((tx) => usersWithPermission(tx, env.organizationId, env.companyId, a.permission!));
  ids = await activeMembers(env.organizationId, ids);
  if (!ids.length) return { notified: 0 };
  const link = a.href && /^\/[^\s]{0,300}$/.test(a.href) ? a.href : href(env);
  const n = await transaction((tx) => notifyUsers(tx, env.organizationId, ids, "automation.notification", { title: a.title.slice(0, 300), href: link, companyId: env.companyId }));
  return { notified: n, userIds: ids };
}

/** Resolve who decides an approval: chosen people, holders of a permission, or the record owner (falls back to the workflow owner). */
async function resolveApprovers(env: ActionEnv, a: Extract<Action, { kind: "request_approval" }>) {
  if (a.approverMode === "permission" && a.permission) return permissionPool(env, a.permission);
  if (a.approverMode === "record_owner") {
    const owners = await activeMembers(env.organizationId, idList(a.ownerField));
    return owners.length ? owners : [env.ownerId];
  }
  return activeMembers(env.organizationId, a.approverIds);
}

async function requestApproval(env: ActionEnv, a: Extract<Action, { kind: "request_approval" }>): Promise<ActionResult> {
  const approverIds = (await resolveApprovers(env, a)).slice(0, 50);
  const escalateToIds = await activeMembers(env.organizationId, a.escalateToIds);
  return transaction(async (tx) => {
    const existing = await tx.workflowApprovalRequest.findUnique({ where: { runId_stepId: { runId: env.runId, stepId: env.stepId } }, select: { id: true, status: true } });
    if (existing && existing.status === "PENDING") return { kind: "wait" as const, waitingFor: "approval" as const, output: { approvalId: existing.id } };
    const timed = !!(a.timeoutAction && a.timeoutHours);
    const fields = {
      title: a.title.slice(0, 300),
      message: blank(a.message)?.slice(0, 2000) ?? null,
      approverIds,
      approverMode: a.approverMode,
      approverPermission: a.approverMode === "permission" ? (a.permission ?? null) : null,
      timeoutHours: timed ? a.timeoutHours! : null,
      timeoutAction: timed ? a.timeoutAction! : null,
      expiresAt: timed ? new Date(Date.now() + a.timeoutHours! * 3_600_000) : null,
      escalateToIds,
      escalatedAt: null,
    };
    const req = existing
      ? await tx.workflowApprovalRequest.update({ where: { id: existing.id }, data: { ...fields, status: "PENDING", decidedById: null, decidedAt: null, note: null }, select: { id: true } })
      : await tx.workflowApprovalRequest.create({ data: { organizationId: env.organizationId, companyId: env.companyId, runId: env.runId, stepId: env.stepId, ...fields }, select: { id: true } });
    const recipients = approverIds.length ? approverIds : await usersWithPermission(tx, env.organizationId, env.companyId, "workflows.execute");
    await notifyUsers(tx, env.organizationId, recipients, "automation.approval_requested", { title: a.title.slice(0, 300), href: "/workflows/approvals", companyId: env.companyId });
    return { kind: "wait" as const, waitingFor: "approval" as const, output: { approvalId: req.id, approvers: approverIds.length } };
  });
}

// ───────────────────────────── External ─────────────────────────────

const skipped = (reason: string) => ({ skipped: true, reason });

async function sendSlack(env: ActionEnv, a: Extract<Action, { kind: "send_slack" }>) {
  const conn = await getConnection(env.organizationId, env.companyId, "slack");
  if (!conn?.accessToken) {
    if (a.ifNotConnected === "skip") return skipped("Slack is not connected");
    throw new PermanentError("Slack is not connected (Integrations → Slack)");
  }
  const res = await providerFetch<{ ok?: boolean; error?: string; ts?: string; channel?: string }>(conn, "https://slack.com/api/chat.postMessage", { method: "POST", json: { channel: a.channel.trim().replace(/^#/, ""), text: a.text } });
  if (!res.ok || !res.data?.ok) {
    const code = res.data?.error ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500 || code === "ratelimited") throw new ProviderError(`Slack: ${code}`, res.status >= 500 ? res.status : 429);
    throw new PermanentError(`Slack rejected the message: ${code}`);
  }
  return { ts: res.data.ts ?? null, channel: res.data.channel ?? a.channel };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Microsoft Teams channel message via Microsoft Graph (the Microsoft 365 connection with ChannelMessage.Send). */
async function sendTeams(env: ActionEnv, a: Extract<Action, { kind: "send_teams" }>) {
  const conn = await getConnection(env.organizationId, env.companyId, "microsoft");
  if (!conn?.accessToken) {
    if (a.ifNotConnected === "skip") return skipped("Microsoft 365 is not connected");
    throw new PermanentError("Microsoft 365 is not connected (Integrations → Microsoft 365)");
  }
  const content = a.text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(a.teamId.trim())}/channels/${encodeURIComponent(a.channelId.trim())}/messages`;
  const res = await providerFetch<{ id?: string; error?: { code?: string } } | null>(conn, url, { method: "POST", json: { body: { contentType: "html", content } } });
  if (!res.ok) {
    const code = (res.data && typeof res.data === "object" ? res.data.error?.code : null) ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new ProviderError(`Teams: ${code}`, res.status);
    throw new PermanentError(`Teams rejected the message: ${code}`);
  }
  return { messageId: res.data?.id ?? null, channelId: a.channelId };
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
      return done({ id: lead.id, name: lead.name, ownerId: lead.ownerId });
    }
    case "create_contact":
      return done(await createContactAction(env, action));
    case "create_account":
      return done(await createAccountAction(env, action));
    case "create_task":
      return done(await createTaskAction(env, action));
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
      return done(await updateTaskField(env, action.recordId.trim(), action.field, action.value));
    }
    case "assign_user":
      return done(await assignTo(env, action.entity, action.recordId, action.userId.trim()));
    case "assign_round_robin":
      return done(await roundRobin(env, action));
    case "load_record":
      return done(await loadRecord(env, action));
    case "create_deal": {
      const deal = await createDeal(env.ctx, env.organizationId, env.companyId, {
        name: action.name.slice(0, 200),
        accountId: blank(action.accountId),
        contactId: blank(action.contactId),
        ownerId: blank(action.ownerId),
        stageId: blank(action.stageId),
        amount: blank(action.amount),
        expectedCloseDate: action.closeInDays !== undefined ? dayIn(action.closeInDays) : undefined,
        source: blank(action.source)?.slice(0, 100),
        description: blank(action.description)?.slice(0, 5000),
      });
      return done({ id: deal.id, name: deal.name, ownerId: deal.ownerId, accountId: deal.accountId, status: deal.status });
    }
    case "move_deal_stage": {
      const deal = await moveDealStage(env.ctx, env.organizationId, env.companyId, action.dealId.trim(), { stageId: action.stageId.trim(), lostReason: blank(action.lostReason) });
      return done({ id: deal.id, stageId: deal.stageId, status: deal.status });
    }
    case "create_project":
      return done(await createProjectAction(env, action));
    case "add_project_members":
      return done(await addMembersAction(env, action));
    case "start_onboarding":
      return done(await onboardingAction(env, action));
    case "create_invoice":
      return done(await invoiceAction(env, action));
    case "create_meeting":
      return done(await meetingAction(env, action));
    case "assign_ai_employee":
    case "generate_ai_content":
      return startAiTask(env, { profile: action.profile, title: action.title, instructions: action.instructions }, action.wait);
    case "ai_employee_task": {
      const id = action.aiEmployeeId.trim();
      if (!isUuid(id)) throw new PermanentError("Choose an AI employee");
      return startAiTask(env, { aiEmployeeId: id, title: action.title, instructions: action.instructions }, action.wait);
    }
    case "decompose_goal":
      return decomposeGoal(env, action);
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
    case "send_teams":
      return done(await sendTeams(env, action));
    case "http_webhook":
      return done(await httpWebhook(env, action, scope));
    case "custom_api":
      return done(await customApi(env, action));
  }
}

/** Kinds whose step can wait for an AI task (the engine polls the task). */
export const AI_TASK_KINDS: readonly string[] = ["assign_ai_employee", "generate_ai_content", "ai_employee_task", "decompose_goal"];
