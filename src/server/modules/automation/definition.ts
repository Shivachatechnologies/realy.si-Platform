import { z } from "zod";
import { DOMAIN_EVENTS } from "@/server/modules/events/catalog";

/**
 * Workflow definition (stored as JSON in WorkflowVersion.definition and Workflow.draft). Pure: safe for client components.
 *
 * Templating: any text field may contain {{event.data.x}}, {{event.entityId}}, {{event.type}}, {{vars.y}} or
 * {{steps.<stepId>.<field>}} (outputs of earlier steps, e.g. the id of a created record).
 */

export const TRIGGER_EVENTS = [...DOMAIN_EVENTS.filter((t) => t !== "schedule.tick" && t !== "webhook.received"), "objective.created", "milestone.completed"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const CONDITION_OPS = ["eq", "neq", "contains", "gt", "lt", "exists", "not_exists"] as const;
export const LEAD_STAGE_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export const WORK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export const WORK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const RECORD_FIELDS = {
  lead: ["stage", "ownerId", "notes", "value", "probability", "expectedCloseDate"],
  work_task: ["status", "priority", "assigneeId", "title", "description", "dueDate"],
} as const;
export const ASSIGN_ENTITIES = ["lead", "work_task", "deal", "ticket"] as const;
export const LOAD_ENTITIES = ["account", "contact", "lead", "deal", "project", "objective", "employee", "candidate", "ticket", "invoice"] as const;
export const ACCOUNT_TYPE_VALUES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"] as const;
export const APPROVER_MODES = ["users", "permission", "record_owner"] as const;
export const ACTION_KINDS = [
  "create_lead",
  "create_contact",
  "create_account",
  "create_task",
  "update_lead",
  "update_record",
  "assign_user",
  "assign_round_robin",
  "load_record",
  "create_deal",
  "move_deal_stage",
  "create_project",
  "add_project_members",
  "start_onboarding",
  "create_invoice",
  "create_meeting",
  "assign_ai_employee",
  "ai_employee_task",
  "decompose_goal",
  "generate_ai_content",
  "notify",
  "request_approval",
  "send_email",
  "send_slack",
  "send_teams",
  "http_webhook",
  "custom_api",
] as const;
/** Action groups for the builder's action picker. */
export const ACTION_GROUPS: Record<"crm" | "work" | "people" | "ai" | "messaging" | "developer", readonly ActionKind[]> = {
  crm: ["create_lead", "create_contact", "create_account", "update_lead", "create_deal", "move_deal_stage", "assign_round_robin"],
  work: ["create_task", "create_project", "add_project_members", "update_record", "assign_user", "load_record"],
  people: ["start_onboarding", "create_meeting", "create_invoice"],
  ai: ["assign_ai_employee", "ai_employee_task", "decompose_goal", "generate_ai_content"],
  messaging: ["notify", "request_approval", "send_email", "send_slack", "send_teams"],
  developer: ["http_webhook", "custom_api"],
};
export type ActionKind = (typeof ACTION_KINDS)[number];
export const STEP_TYPES = ["condition", "branch", "action", "delay", "set_variable"] as const;

const tpl = (max = 2000) => z.string().max(max);
const req = (max = 2000) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const uuids = (max = 50) => z.array(uuid).max(max).default([]);
const days = (max = 365) => z.number().int().min(0).max(max).optional();
const permissionKey = z.string().regex(/^[a-z_]+\.[a-z_]+$/);
const ifNotConnected = z.enum(["fail", "skip"]).default("fail");

export const conditionSchema = z.object({
  field: z.string().regex(/^(event|vars|steps)(\.[A-Za-z0-9_-]{1,64}){1,4}$/, "Use event.data.field, vars.name or steps.<id>.field"),
  op: z.enum(CONDITION_OPS),
  value: tpl(500).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_lead"), name: req(), email: tpl().optional(), phone: tpl().optional(), source: tpl().optional(), notes: tpl().optional(), ownerId: tpl().optional() }),
  z.object({ kind: z.literal("create_contact"), firstName: req(), lastName: tpl().optional(), email: tpl().optional(), phone: tpl().optional(), title: tpl().optional(), accountId: tpl().optional(), ownerId: tpl().optional() }),
  z.object({ kind: z.literal("create_account"), name: req(), type: z.enum(ACCOUNT_TYPE_VALUES).default("PROSPECT"), email: tpl().optional(), phone: tpl().optional(), website: tpl().optional(), source: tpl().optional(), ownerId: tpl().optional() }),
  z.object({
    kind: z.literal("create_task"),
    title: req(),
    description: tpl(5000).optional(),
    assigneeId: tpl().optional(),
    projectId: tpl().optional(),
    priority: z.enum(WORK_PRIORITIES).default("MEDIUM"),
    dueInDays: days(),
  }),
  z.object({ kind: z.literal("update_lead"), leadId: req(), stage: z.enum(LEAD_STAGE_VALUES).optional(), ownerId: tpl().optional() }),
  z.object({ kind: z.literal("update_record"), entity: z.enum(["lead", "work_task"]), recordId: req(), field: z.string().max(40), value: tpl(5000) }),
  z.object({ kind: z.literal("assign_user"), entity: z.enum(ASSIGN_ENTITIES), recordId: req(), userId: req() }),
  z.object({
    kind: z.literal("assign_round_robin"),
    entity: z.enum(ASSIGN_ENTITIES),
    recordId: req(),
    /** users: rotate through `userIds`; permission: rotate through holders of `permission`; crm_rules: the CRM's lead assignment rules. */
    pool: z.enum(["users", "permission", "crm_rules"]).default("users"),
    userIds: uuids(),
    permission: permissionKey.optional(),
    /** Used when the CRM rules pick nobody. */
    fallbackPermission: permissionKey.optional(),
  }),
  z.object({ kind: z.literal("load_record"), entity: z.enum(LOAD_ENTITIES), recordId: req() }),
  z.object({
    kind: z.literal("create_deal"),
    name: req(200),
    accountId: tpl().optional(),
    contactId: tpl().optional(),
    ownerId: tpl().optional(),
    stageId: tpl().optional(),
    /** Major units ("12000.50"). */
    amount: tpl(40).optional(),
    closeInDays: days(730),
    source: tpl().optional(),
    description: tpl(5000).optional(),
  }),
  z.object({ kind: z.literal("move_deal_stage"), dealId: req(), stageId: req(), lostReason: tpl(300).optional() }),
  z.object({
    kind: z.literal("create_project"),
    name: req(120),
    description: tpl(5000).optional(),
    /** Built-in project template key or a saved template id ("" = blank project). */
    template: tpl(60).optional(),
    ownerId: tpl().optional(),
    memberIds: uuids(100),
    /** Comma-separated user ids from variables, e.g. "{{event.data.ownerId}},{{steps.account.ownerId}}". */
    extraMemberIds: tpl().optional(),
    startInDays: days(),
    dueInDays: days(730),
  }),
  z.object({ kind: z.literal("add_project_members"), projectId: req(), userIds: uuids(100), extraUserIds: tpl().optional(), role: tpl(80).optional() }),
  z.object({ kind: z.literal("start_onboarding"), employeeId: req(), checklist: z.enum(["ONBOARDING", "OFFBOARDING"]).default("ONBOARDING"), templateId: tpl().optional() }),
  z.object({
    kind: z.literal("create_invoice"),
    accountId: req(),
    description: req(500),
    quantity: tpl(20).default("1"),
    /** Major units. */
    unitPrice: req(40),
    dueInDays: days(),
    notes: tpl(5000).optional(),
  }),
  z.object({
    kind: z.literal("create_meeting"),
    title: req(200),
    agenda: tpl(10000).optional(),
    location: tpl(300).optional(),
    /** ISO date-time from a variable; when empty the meeting starts `startInHours` from now. */
    startsAt: tpl(60).optional(),
    startInHours: z.number().int().min(0).max(2160).default(24),
    durationMinutes: z.number().int().min(5).max(1440).default(30),
    attendeeIds: uuids(100),
    extraAttendeeIds: tpl().optional(),
  }),
  z.object({ kind: z.literal("assign_ai_employee"), profile: z.string().regex(/^[a-z0-9_]{2,60}$/), title: req(200), instructions: req(8000), wait: z.boolean().default(false) }),
  z.object({ kind: z.literal("ai_employee_task"), aiEmployeeId: req(100), title: req(200), instructions: req(8000), wait: z.boolean().default(true) }),
  z.object({ kind: z.literal("decompose_goal"), objectiveId: req(), guidance: tpl(4000).optional(), wait: z.boolean().default(true) }),
  z.object({
    kind: z.literal("notify"),
    recipients: z.enum(["owner", "users", "permission", "field"]).default("owner"),
    userIds: uuids(),
    permission: permissionKey.optional(),
    /** A user id (or comma-separated ids) from a variable (recipients "field"). */
    userField: tpl().optional(),
    title: req(300),
    href: z.string().regex(/^\/[^\s]{0,300}$/).optional().or(z.literal("")),
  }),
  z.object({
    kind: z.literal("request_approval"),
    title: req(300),
    message: tpl(2000).optional(),
    approverMode: z.enum(APPROVER_MODES).default("users"),
    approverIds: z.array(uuid).max(20).default([]),
    permission: permissionKey.optional(),
    /** The record owner's user id from a variable (approverMode "record_owner"), e.g. {{event.data.ownerId}}. */
    ownerField: tpl().optional(),
    timeoutHours: z.number().int().min(1).max(720).optional(),
    timeoutAction: z.enum(["reject", "escalate"]).optional(),
    escalateToIds: z.array(uuid).max(20).default([]),
  }),
  z.object({ kind: z.literal("generate_ai_content"), profile: z.string().regex(/^[a-z0-9_]{2,60}$/), title: req(200), instructions: req(8000), wait: z.boolean().default(true) }),
  z.object({ kind: z.literal("send_email"), to: req(500), subject: req(300), body: req(10000) }),
  z.object({ kind: z.literal("send_slack"), channel: req(100), text: req(4000), ifNotConnected }),
  z.object({ kind: z.literal("send_teams"), teamId: req(200), channelId: req(200), text: req(4000), ifNotConnected }),
  z.object({ kind: z.literal("http_webhook"), url: z.string().trim().url().max(2000), body: tpl(10000).optional() }),
  z.object({ kind: z.literal("custom_api"), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"), path: z.string().regex(/^\/[^\s]{0,500}$/), body: tpl(10000).optional() }),
]);
export type Action = z.infer<typeof actionSchema>;

const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/, "Lowercase letters, digits, - and _");

export type Step =
  | { id: string; type: "condition"; match: "all" | "any"; conditions: Condition[] }
  | { id: string; type: "branch"; match: "all" | "any"; conditions: Condition[]; then: Step[]; else: Step[] }
  | { id: string; type: "action"; action: Action }
  | { id: string; type: "delay"; amount: number; unit: "minutes" | "hours" | "days" }
  | { id: string; type: "set_variable"; name: string; value: string };

export const stepSchema: z.ZodType<Step, unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ id: stepId, type: z.literal("condition"), match: z.enum(["all", "any"]).default("all"), conditions: z.array(conditionSchema).min(1).max(20) }),
    z.object({
      id: stepId,
      type: z.literal("branch"),
      match: z.enum(["all", "any"]).default("all"),
      conditions: z.array(conditionSchema).min(1).max(20),
      then: z.array(stepSchema).max(50),
      else: z.array(stepSchema).max(50),
    }),
    z.object({ id: stepId, type: z.literal("action"), action: actionSchema }),
    z.object({ id: stepId, type: z.literal("delay"), amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]) }),
    z.object({ id: stepId, type: z.literal("set_variable"), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), value: tpl(2000) }),
  ]),
) as z.ZodType<Step, unknown>;

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(15).max(7 * 24 * 60) }),
  z.object({ kind: z.literal("daily"), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("weekly"), day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: z.enum(TRIGGER_EVENTS), filters: z.array(conditionSchema).max(20).default([]) }),
  z.object({ type: z.literal("schedule"), schedule: scheduleSchema, filters: z.array(conditionSchema).max(0).default([]) }),
  z.object({ type: z.literal("webhook"), hookId: uuid, filters: z.array(conditionSchema).max(20).default([]) }),
  z.object({ type: z.literal("manual"), filters: z.array(conditionSchema).max(0).default([]) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const definitionSchema = z.object({
  trigger: triggerSchema,
  variables: z
    .array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), value: tpl(2000) }))
    .max(30)
    .default([]),
  steps: z.array(stepSchema).max(50),
});
export type Definition = z.infer<typeof definitionSchema>;

export const EMPTY_DEFINITION: Definition = { trigger: { type: "manual", filters: [] }, variables: [], steps: [] };

/** All steps of a tree, depth-first. */
export function flattenSteps(steps: Step[]): Step[] {
  return steps.flatMap((s) => (s.type === "branch" ? [s, ...flattenSteps(s.then), ...flattenSteps(s.else)] : [s]));
}

export interface DefinitionIssue {
  path: string;
  message: string;
}

/** Parse + semantic validation (unique step ids, at least one step, references to earlier steps). */
export function validateDefinition(raw: unknown): { ok: true; definition: Definition } | { ok: false; issues: DefinitionIssue[] } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const def = parsed.data;
  const issues: DefinitionIssue[] = [];
  const all = flattenSteps(def.steps);
  if (!all.length) issues.push({ path: "steps", message: "Add at least one step" });
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) issues.push({ path: `steps.${s.id}`, message: `Duplicate step id ${s.id}` });
    seen.add(s.id);
    if (s.type === "action" && s.action.kind === "update_record" && !(RECORD_FIELDS[s.action.entity] as readonly string[]).includes(s.action.field)) {
      issues.push({ path: `steps.${s.id}.action.field`, message: `Field ${s.action.field} cannot be set on ${s.action.entity}` });
    }
    if (s.type === "action" && s.action.kind === "notify" && s.action.recipients === "users" && !s.action.userIds.length) issues.push({ path: `steps.${s.id}.action.userIds`, message: "Choose at least one person" });
    if (s.type === "action" && s.action.kind === "notify" && s.action.recipients === "permission" && !s.action.permission) issues.push({ path: `steps.${s.id}.action.permission`, message: "Choose a permission" });
    if (s.type === "action" && s.action.kind === "notify" && s.action.recipients === "field" && !s.action.userField?.trim()) issues.push({ path: `steps.${s.id}.action.userField`, message: "Set the variable holding the person" });
    if (s.type === "action") issues.push(...actionIssues(s.id, s.action));
  }
  return issues.length ? { ok: false, issues } : { ok: true, definition: def };
}

function actionIssues(id: string, a: Action): DefinitionIssue[] {
  const out: DefinitionIssue[] = [];
  const at = (f: string, message: string) => out.push({ path: `steps.${id}.action.${f}`, message });
  if (a.kind === "assign_round_robin") {
    if (a.pool === "users" && !a.userIds.length) at("userIds", "Choose at least one person to rotate through");
    if (a.pool === "permission" && !a.permission) at("permission", "Choose a permission");
    if (a.pool === "crm_rules" && a.entity !== "lead") at("pool", "CRM assignment rules only apply to leads");
  }
  if (a.kind === "request_approval") {
    if (a.approverMode === "permission" && !a.permission) at("permission", "Choose the permission whose holders approve");
    if (a.approverMode === "record_owner" && !a.ownerField?.trim()) at("ownerField", "Set the variable holding the record owner");
    if (a.timeoutAction && !a.timeoutHours) at("timeoutHours", "Set the timeout in hours");
    if (a.timeoutAction === "escalate" && !a.escalateToIds.length) at("escalateToIds", "Choose who the request escalates to");
  }
  return out;
}

// ───────────────────────────── Evaluation (templating + conditions) ─────────────────────────────

export interface EvalScope {
  event: Record<string, unknown>;
  vars: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
}

export function resolvePath(scope: EvalScope, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    if (p === "__proto__" || p === "constructor" || p === "prototype") return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, p) ? (cur as Record<string, unknown>)[p] : undefined;
  }
  return cur;
}

const TEMPLATE = /\{\{\s*((?:event|vars|steps)(?:\.[A-Za-z0-9_-]{1,64}){1,4})\s*\}\}/g;

export function render(template: string | undefined | null, scope: EvalScope): string {
  if (!template) return "";
  return template.replace(TEMPLATE, (_m, path: string) => {
    const v = resolvePath(scope, path);
    if (v === null || v === undefined) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const asTime = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : null);

export function evaluateCondition(c: Condition, scope: EvalScope): boolean {
  const actual = resolvePath(scope, c.field);
  const expected = render(c.value ?? "", scope);
  const present = actual !== undefined && actual !== null && actual !== "";
  switch (c.op) {
    case "exists":
      return present;
    case "not_exists":
      return !present;
    case "eq":
    case "neq": {
      const a = num(actual);
      const b = num(expected);
      const eq = a !== null && b !== null ? a === b : String(actual ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
      return c.op === "eq" ? eq : !eq;
    }
    case "contains":
      return String(actual ?? "").toLowerCase().includes(expected.toLowerCase());
    case "gt":
    case "lt": {
      const a = num(actual) ?? asTime(actual);
      const b = num(expected) ?? asTime(expected);
      if (a === null || b === null) return false;
      return c.op === "gt" ? a > b : a < b;
    }
  }
}

export function evaluateAll(conditions: Condition[], match: "all" | "any", scope: EvalScope): boolean {
  if (!conditions.length) return true;
  return match === "all" ? conditions.every((c) => evaluateCondition(c, scope)) : conditions.some((c) => evaluateCondition(c, scope));
}

/** The trigger's event type key used for matching ("event" → event type, "webhook" → hook id). */
export function triggerKeyOf(t: Trigger): string | null {
  return t.type === "event" ? t.event : t.type === "webhook" ? t.hookId : null;
}

/** Variables available to templates for a trigger, for the builder's variable picker. */
export function variableSuggestions(def: Definition): string[] {
  const out = ["event.type", "event.entityId", "event.entityType", "event.occurredAt"];
  if (def.trigger.type === "event" || def.trigger.type === "webhook") out.push("event.data.name", "event.data.email", "event.data.ownerId", "event.data.status");
  if (def.trigger.type === "webhook") out.push("event.data.hookName", "event.data.deliveryId");
  for (const v of def.variables) out.push(`vars.${v.name}`);
  for (const s of flattenSteps(def.steps)) {
    if (s.type === "set_variable") out.push(`vars.${s.name}`);
    if (s.type === "action") {
      const k = s.action.kind;
      if (!["notify", "send_email", "send_slack", "send_teams", "http_webhook", "custom_api", "request_approval"].includes(k)) out.push(`steps.${s.id}.id`);
      if (["generate_ai_content", "assign_ai_employee", "ai_employee_task", "decompose_goal"].includes(k)) out.push(`steps.${s.id}.output`);
      if (k === "load_record") out.push(`steps.${s.id}.name`, `steps.${s.id}.ownerId`, `steps.${s.id}.email`, `steps.${s.id}.accountId`);
      if (k === "assign_round_robin") out.push(`steps.${s.id}.userId`);
      if (k === "create_project" || k === "create_account" || k === "create_deal") out.push(`steps.${s.id}.name`);
      if (k === "create_invoice") out.push(`steps.${s.id}.number`);
      if (k === "start_onboarding") out.push(`steps.${s.id}.tasks`);
      if (s.action.kind === "request_approval") out.push(`steps.${s.id}.note`);
      if (s.action.kind === "http_webhook" || s.action.kind === "custom_api") out.push(`steps.${s.id}.status`, `steps.${s.id}.body`);
    }
  }
  return [...new Set(out)];
}
