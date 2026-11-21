import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { getControls, getOrgOverride, isOrganizationSuspended } from "@/server/core/platform-controls";
import { minorUnits } from "@/i18n/format";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import {
  ALL_DEPARTMENTS,
  DEFAULT_LEVEL,
  MONEY_CLASSES,
  NEVER_AUTO,
  PAYMENT_HARD_CAP_MAJOR,
  type ActionClass,
  type AutonomyLevelKey,
} from "./autonomy-classes";

/**
 * Autonomy policy engine (docs/autonomy.md). One place decides whether the AI may do something on its own:
 *
 *   evaluateAutonomy()        → "auto" | "ask" | "deny" with the reason and the policy that decided it (read-only)
 *   runAutonomously()         → evaluate + reserve the limits atomically, perform, record (preferred for modules)
 *   recordAutonomousAction()  → record an action a module already performed after an "auto" decision
 *
 * The tool gateway (tools/gateway.ts) uses the same engine for every SUPERVISED tool an AI task calls. Hard floors
 * (contracts/legal, hiring/firing, deleting data, payments above the hard cap, FOUNDER_ONLY tools, platform kill
 * switches) can never be "auto", whatever a policy says. With Auto mode off for the company, AUTO rules act as ASK.
 */

export interface AutonomyRequest {
  /** workforce department key (sales, marketing, …) of the AI employee / role acting. */
  department: string;
  actionClass: ActionClass;
  amountMinor?: bigint | number | null;
  currency?: string | null;
  channel?: string | null;
}

export type AutonomyReason =
  | "auto_allowed"
  | "auto_mode_off"
  | "policy_ask"
  | "policy_suggest"
  | "policy_off"
  | "company_paused"
  | "platform_paused"
  | "platform_supervised"
  | "hard_floor"
  | "founder_only"
  | "payment_hard_cap"
  | "amount_unknown"
  | "currency_mismatch"
  | "per_action_cap"
  | "daily_money_cap"
  | "monthly_money_cap"
  | "daily_limit"
  | "outside_hours"
  | "channel_not_allowed";

/** The effective rule for one department and class (a stored policy row, or the built-in default). */
export interface AutonomyRule {
  policyId: string | null;
  /** The row's department: the department itself, "*" (company-wide) or null (built-in default). */
  scope: string | null;
  level: AutonomyLevelKey;
  dailyLimit: number | null;
  perActionMaxMinor: bigint | null;
  dailyMaxMinor: bigint | null;
  monthlyMaxMinor: bigint | null;
  currency: string | null;
  hoursFrom: string | null;
  hoursTo: string | null;
  allowedDays: number[];
  allowedChannels: string[];
  demotedAt: Date | null;
  demotionReason: string | null;
}

export interface AutonomyDecision {
  decision: "auto" | "ask" | "deny";
  reason: AutonomyReason;
  /** The policy row that decided (null = built-in default). */
  policyId: string | null;
  level: AutonomyLevelKey;
  rule: AutonomyRule;
  /** Plain-language explanation (English; shown to the AI and in logs). */
  message: string;
}

const MESSAGES: Record<AutonomyReason, string> = {
  auto_allowed: "Allowed automatically by the company's autonomy policy",
  auto_mode_off: "Auto mode is off for this company, so a person approves it",
  policy_ask: "The autonomy policy asks a person to approve this",
  policy_suggest: "The autonomy policy allows only suggestions for this kind of action",
  policy_off: "The autonomy policy turns this kind of action off for the AI",
  company_paused: "All AI in this company is paused",
  platform_paused: "The platform has paused AI actions",
  platform_supervised: "The platform's AI policy requires approval for actions that change data",
  hard_floor: "This kind of action always needs a person (hard floor)",
  founder_only: "Only the organization owner can approve this action",
  payment_hard_cap: `Payments above ${PAYMENT_HARD_CAP_MAJOR} always need a person (hard floor)`,
  amount_unknown: "The amount is not known, so the money limits cannot be checked",
  currency_mismatch: "The amount is in a different currency than the policy's limits",
  per_action_cap: "The amount is above the per-action limit",
  daily_money_cap: "Today's spending limit would be exceeded",
  monthly_money_cap: "This month's spending limit would be exceeded",
  daily_limit: "Today's limit for this kind of action is used up",
  outside_hours: "Outside the hours the AI may act on its own",
  channel_not_allowed: "The AI may not use this channel on its own",
};

const DEFAULT_RULE = (actionClass: ActionClass): AutonomyRule => ({
  policyId: null,
  scope: null,
  level: DEFAULT_LEVEL[actionClass],
  dailyLimit: null,
  perActionMaxMinor: null,
  dailyMaxMinor: null,
  monthlyMaxMinor: null,
  currency: null,
  hoursFrom: null,
  hoursTo: null,
  allowedDays: [],
  allowedChannels: [],
  demotedAt: null,
  demotionReason: null,
});

type Client = Tx | ReturnType<typeof db>;

type PolicyRow = Prisma.AutonomyPolicyGetPayload<object>;
export function ruleOf(row: PolicyRow): AutonomyRule {
  return {
    policyId: row.id,
    scope: row.department,
    level: row.level,
    dailyLimit: row.dailyLimit,
    perActionMaxMinor: row.perActionMaxMinor,
    dailyMaxMinor: row.dailyMaxMinor,
    monthlyMaxMinor: row.monthlyMaxMinor,
    currency: row.currency,
    hoursFrom: row.hoursFrom,
    hoursTo: row.hoursTo,
    allowedDays: row.allowedDays,
    allowedChannels: row.allowedChannels,
    demotedAt: row.demotedAt,
    demotionReason: row.demotionReason,
  };
}

/** The rule for a department and class: the department's row, else the company-wide row, else the default. */
export async function resolveRule(client: Client, organizationId: string, companyId: string, department: string, actionClass: ActionClass): Promise<AutonomyRule> {
  const rows = await client.autonomyPolicy.findMany({ where: { organizationId, companyId, actionClass, department: { in: [department, ALL_DEPARTMENTS] } } });
  const row = rows.find((r) => r.department === department) ?? rows.find((r) => r.department === ALL_DEPARTMENTS);
  return row ? ruleOf(row) : DEFAULT_RULE(actionClass);
}

export async function companySettings(client: Client, organizationId: string, companyId: string) {
  const s = await client.autonomySettings.findUnique({ where: { companyId } });
  if (s && s.organizationId !== organizationId) return null;
  return s;
}

/** Day, month, "HH:MM" and weekday in the company's timezone. */
export function companyClock(timezone: string | null | undefined, now = new Date()) {
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return companyClock("UTC", now);
  }
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

/** Is `time` ("HH:MM") inside [from, to)? A window like 22:00–06:00 wraps past midnight. */
export function inWindow(time: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  return from <= to ? time >= from && time < to : time >= from || time < to;
}

const toBig = (v: bigint | number | null | undefined) => (v === null || v === undefined ? null : typeof v === "bigint" ? v : BigInt(Math.trunc(v)));

/** The payment hard cap in minor units of `currency`. */
export const paymentHardCapMinor = (currency: string) => BigInt(PAYMENT_HARD_CAP_MAJOR) * 10n ** BigInt(minorUnits(currency));

/** Platform kill switches and AI ceilings (Admin → AI & Workforce), and the organization's platform state. */
async function platformGate(organizationId: string, actionClass: ActionClass): Promise<"ok" | "deny" | "ask"> {
  const c = await getControls();
  if (!c.aiWorkforceEnabled || c.aiExecutionPaused || c.readOnlyMode || c.maintenanceMode || c.lockdown) return "deny";
  if ((await getOrgOverride(organizationId)).aiDisabled || (await isOrganizationSuspended(organizationId))) return "deny";
  if (actionClass === "read") return "ok";
  if (c.aiAutonomyCeiling === "read_only") return "deny";
  if (c.aiAutonomyCeiling === "supervised" || c.aiRequireApprovalForWrites) return "ask";
  return "ok";
}

interface EvalOptions {
  /** The tool gateway's platform tool policy result (already computed there). */
  platform?: "as_defined" | "supervised" | "denied";
  /** The tool is FOUNDER_ONLY (never automatic). */
  founderOnly?: boolean;
  now?: Date;
}

const decide = (decision: AutonomyDecision["decision"], reason: AutonomyReason, rule: AutonomyRule): AutonomyDecision => ({
  decision,
  reason,
  policyId: rule.policyId,
  level: rule.level,
  rule,
  message: MESSAGES[reason],
});

/** Core evaluation on a client (inside the reservation transaction or not). Never writes. */
async function evaluateOn(client: Client, organizationId: string, companyId: string, req: AutonomyRequest, opts: EvalOptions = {}): Promise<AutonomyDecision> {
  const [rule, settings, company] = await Promise.all([
    resolveRule(client, organizationId, companyId, req.department, req.actionClass),
    companySettings(client, organizationId, companyId),
    client.company.findFirst({ where: { id: companyId, organizationId }, select: { timezone: true } }),
  ]);
  if (!company) return decide("deny", "policy_off", rule);
  if (settings?.paused) return decide("deny", "company_paused", rule);
  const gate = opts.platform === "denied" ? "deny" : await platformGate(organizationId, req.actionClass);
  if (gate === "deny") return decide("deny", "platform_paused", rule);
  if (rule.level === "OFF") return decide("deny", "policy_off", rule);
  if (rule.level === "SUGGEST") return decide("deny", "policy_suggest", rule);
  if (rule.level === "ASK") return decide("ask", "policy_ask", rule);

  // AUTO: hard floors first, then the company switch, then the rule's limits.
  if (req.actionClass === "read") return decide("auto", "auto_allowed", rule);
  if (NEVER_AUTO.includes(req.actionClass)) return decide("ask", "hard_floor", rule);
  if (opts.founderOnly) return decide("ask", "founder_only", rule);
  if (gate === "ask" || opts.platform === "supervised") return decide("ask", "platform_supervised", rule);
  if (!settings?.autoModeEnabled) return decide("ask", "auto_mode_off", rule);

  const clock = companyClock(company.timezone, opts.now);
  if (rule.allowedDays.length && !rule.allowedDays.includes(clock.weekday)) return decide("ask", "outside_hours", rule);
  if (!inWindow(clock.time, rule.hoursFrom, rule.hoursTo)) return decide("ask", "outside_hours", rule);
  if (rule.allowedChannels.length && (!req.channel || !rule.allowedChannels.includes(req.channel))) return decide("ask", "channel_not_allowed", rule);

  const amount = toBig(req.amountMinor);
  const isMoney = MONEY_CLASSES.includes(req.actionClass);
  const hasMoneyCaps = rule.perActionMaxMinor !== null || rule.dailyMaxMinor !== null || rule.monthlyMaxMinor !== null;
  if (isMoney || (hasMoneyCaps && amount !== null)) {
    // Money classes need a known amount and a per-action cap to run on their own.
    if (amount === null || !req.currency) return decide("ask", "amount_unknown", rule);
    if (isMoney && rule.perActionMaxMinor === null) return decide("ask", "per_action_cap", rule);
    if (req.actionClass === "pay" && amount > paymentHardCapMinor(req.currency)) return decide("ask", "payment_hard_cap", rule);
    if (hasMoneyCaps && rule.currency && rule.currency !== req.currency) return decide("ask", "currency_mismatch", rule);
    if (rule.perActionMaxMinor !== null && amount > rule.perActionMaxMinor) return decide("ask", "per_action_cap", rule);
  }

  // Usage counted at the rule's scope: a company-wide rule counts the whole company, a department rule its department.
  const scope = { organizationId, companyId, actionClass: req.actionClass, status: { in: ["RUNNING", "EXECUTED"] as ("RUNNING" | "EXECUTED")[] }, ...(rule.scope && rule.scope !== ALL_DEPARTMENTS ? { department: rule.scope } : {}) };
  if (rule.dailyLimit !== null) {
    const used = await client.autonomousAction.count({ where: { ...scope, day: clock.day } });
    if (used >= rule.dailyLimit) return decide("ask", "daily_limit", rule);
  }
  if (amount !== null && req.currency && (rule.dailyMaxMinor !== null || rule.monthlyMaxMinor !== null)) {
    if (rule.dailyMaxMinor !== null) {
      const s = await client.autonomousAction.aggregate({ where: { ...scope, day: clock.day, currency: req.currency }, _sum: { amountMinor: true } });
      if ((s._sum.amountMinor ?? 0n) + amount > rule.dailyMaxMinor) return decide("ask", "daily_money_cap", rule);
    }
    if (rule.monthlyMaxMinor !== null) {
      const s = await client.autonomousAction.aggregate({ where: { ...scope, month: clock.month, currency: req.currency }, _sum: { amountMinor: true } });
      if ((s._sum.amountMinor ?? 0n) + amount > rule.monthlyMaxMinor) return decide("ask", "monthly_money_cap", rule);
    }
  }
  return decide("auto", "auto_allowed", rule);
}

/**
 * May the AI do this on its own right now? Read-only; `ctx` identifies the caller for logs. Call it before any
 * non-tool action a module performs for an AI employee, then `recordAutonomousAction` after acting — or use
 * `runAutonomously`, which reserves the limits atomically.
 */
export async function evaluateAutonomy(_ctx: RequestContext, organizationId: string, companyId: string, req: AutonomyRequest, opts: EvalOptions = {}): Promise<AutonomyDecision> {
  return evaluateOn(db(), organizationId, companyId, req, opts);
}

export interface AutonomousActionMeta {
  summary: string;
  aiEmployeeId?: string | null;
  taskId?: string | null;
  tool?: string | null;
  /** Module recording a non-tool action, e.g. "crm". */
  source?: string | null;
  input?: unknown;
}

const snapshot = (rule: AutonomyRule) => ({
  policyId: rule.policyId,
  scope: rule.scope,
  level: rule.level,
  dailyLimit: rule.dailyLimit,
  perActionMaxMinor: rule.perActionMaxMinor?.toString() ?? null,
  dailyMaxMinor: rule.dailyMaxMinor?.toString() ?? null,
  monthlyMaxMinor: rule.monthlyMaxMinor?.toString() ?? null,
  currency: rule.currency,
  hoursFrom: rule.hoursFrom,
  hoursTo: rule.hoursTo,
  allowedDays: rule.allowedDays,
  allowedChannels: rule.allowedChannels,
});

const json = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue));

/**
 * Evaluate and, when "auto", reserve the limits in one serialized transaction (a RUNNING row counts immediately, so
 * two concurrent actions can never both take the last slot). Returns the decision and, if reserved, the action id.
 */
export async function reserveAutonomousAction(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  req: AutonomyRequest,
  meta: AutonomousActionMeta,
  opts: EvalOptions = {},
): Promise<AutonomyDecision & { actionId: string | null }> {
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`autonomy:${companyId}:${req.actionClass}`}))`;
    const d = await evaluateOn(tx, organizationId, companyId, req, opts);
    if (d.decision !== "auto") return { ...d, actionId: null };
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { timezone: true } });
    const clock = companyClock(company.timezone, opts.now);
    const row = await tx.autonomousAction.create({
      data: {
        organizationId,
        companyId,
        department: req.department,
        actionClass: req.actionClass,
        policyId: d.policyId,
        policySnapshot: json(snapshot(d.rule)) ?? {},
        aiEmployeeId: meta.aiEmployeeId ?? null,
        taskId: meta.taskId ?? null,
        tool: meta.tool ?? null,
        source: meta.source ?? null,
        summary: meta.summary.slice(0, 1000),
        input: json(meta.input),
        channel: req.channel ?? null,
        amountMinor: toBig(req.amountMinor),
        currency: req.currency ?? null,
        status: "RUNNING",
        day: clock.day,
        month: clock.month,
      },
    });
    // The "auto-approved" activity entry: who allowed it (the policy) and what it was.
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "autonomy.auto_approved",
      resourceType: "autonomous_action",
      resourceId: row.id,
      newValue: { companyId, department: req.department, actionClass: req.actionClass, tool: meta.tool ?? null, source: meta.source ?? null, summary: row.summary, policyId: d.policyId, policy: snapshot(d.rule), amountMinor: row.amountMinor?.toString() ?? null, currency: row.currency, channel: row.channel, taskId: row.taskId },
    });
    return { ...d, actionId: row.id };
  });
}

/** Close a reserved action with its outcome. A failure is a trust signal (it may demote the rule). */
export async function finishAutonomousAction(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  actionId: string,
  outcome: { ok: true; result?: string; records?: string[]; undo?: { tool: string; input: unknown } | null } | { ok: false; error: string },
) {
  const row = await transaction(async (tx) => {
    const a = await tx.autonomousAction.update({
      where: { id: actionId },
      data: outcome.ok
        ? { status: "EXECUTED", result: outcome.result?.slice(0, 2000) ?? null, records: outcome.records ?? [], undo: json(outcome.undo ?? undefined) }
        : { status: "FAILED", error: outcome.error.slice(0, 500) },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: outcome.ok ? "autonomy.action_executed" : "autonomy.action_failed",
      resourceType: "autonomous_action",
      resourceId: actionId,
      newValue: outcome.ok ? { companyId, records: outcome.records ?? [], reversible: !!outcome.undo } : { companyId, error: outcome.error.slice(0, 500) },
    });
    return a;
  });
  if (!outcome.ok) await checkDemotion(organizationId, companyId, row.department, row.actionClass as ActionClass, "failure");
  return row;
}

/**
 * Record an action a module carried out on its own after `evaluateAutonomy` returned "auto". Counts toward limits and
 * appears in the auto-approved log. `undo` (optional) names a registered tool + input that reverses it.
 */
export async function recordAutonomousAction(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  input: AutonomyRequest & AutonomousActionMeta & { decision: Pick<AutonomyDecision, "decision" | "rule">; records?: string[]; result?: string; undo?: { tool: string; input: unknown } | null },
) {
  if (input.decision.decision !== "auto") throw new Error("recordAutonomousAction needs an \"auto\" decision");
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { timezone: true } });
  const clock = companyClock(company.timezone);
  return transaction(async (tx) => {
    const row = await tx.autonomousAction.create({
      data: {
        organizationId,
        companyId,
        department: input.department,
        actionClass: input.actionClass,
        policyId: input.decision.rule.policyId,
        policySnapshot: json(snapshot(input.decision.rule)) ?? {},
        aiEmployeeId: input.aiEmployeeId ?? null,
        taskId: input.taskId ?? null,
        tool: input.tool ?? null,
        source: input.source ?? null,
        summary: input.summary.slice(0, 1000),
        input: json(input.input),
        channel: input.channel ?? null,
        amountMinor: toBig(input.amountMinor),
        currency: input.currency ?? null,
        status: "EXECUTED",
        records: input.records ?? [],
        result: input.result?.slice(0, 2000) ?? null,
        undo: json(input.undo ?? undefined),
        day: clock.day,
        month: clock.month,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "autonomy.auto_approved",
      resourceType: "autonomous_action",
      resourceId: row.id,
      newValue: { companyId, department: row.department, actionClass: row.actionClass, source: row.source, tool: row.tool, summary: row.summary, policyId: row.policyId, policy: snapshot(input.decision.rule), records: row.records },
    });
    return row;
  });
}

/**
 * Evaluate, reserve, perform and record in one call. `perform` runs only when the decision is "auto"; otherwise the
 * decision is returned and the caller files an approval / shows a suggestion / refuses.
 */
export async function runAutonomously<T>(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  req: AutonomyRequest,
  meta: AutonomousActionMeta,
  perform: () => Promise<{ value: T; records?: string[]; result?: string; undo?: { tool: string; input: unknown } | null }>,
): Promise<{ decision: AutonomyDecision; actionId: string | null; value?: T }> {
  const r = await reserveAutonomousAction(ctx, organizationId, companyId, req, meta);
  if (!r.actionId) return { decision: r, actionId: null };
  try {
    const out = await perform();
    await finishAutonomousAction(ctx, organizationId, companyId, r.actionId, { ok: true, result: out.result, records: out.records, undo: out.undo ?? null });
    return { decision: r, actionId: r.actionId, value: out.value };
  } catch (err) {
    await finishAutonomousAction(ctx, organizationId, companyId, r.actionId, { ok: false, error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    throw err;
  }
}

/** Is all AI paused for this company ("Pause all AI")? */
export async function isCompanyAiPaused(organizationId: string, companyId: string): Promise<boolean> {
  try {
    return !!(await companySettings(db(), organizationId, companyId))?.paused;
  } catch (err) {
    // Table missing (not migrated yet): behave as before autonomy existed.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autonomy settings unavailable");
    return false;
  }
}

// ───────────── Trust: automatic demotion ─────────────

export type NegativeSignal = "rejection" | "failure" | "reversal" | "complaint" | "edit";

/** Department of an approval: its task's AI employee, else the requesting profile's department. */
async function approvalDepartment(a: { requestedByProfile: string | null; task: { aiEmployee: { department: string } | null } | null }): Promise<string> {
  if (a.task?.aiEmployee?.department) return a.task.aiEmployee.department;
  const { profileByKey } = await import("@/server/modules/agents/profiles");
  return (a.requestedByProfile && profileByKey(a.requestedByProfile)?.department) || "operations";
}

/** Count negative trust signals for a department/class since `since` (rejections, failures, undos, complaints). */
export async function negativeSignals(organizationId: string, companyId: string, department: string | null, actionClass: ActionClass, since: Date): Promise<number> {
  const deptFilter = department && department !== ALL_DEPARTMENTS ? { department } : {};
  const [actions, feedback, approvals] = await Promise.all([
    db().autonomousAction.count({ where: { organizationId, companyId, actionClass, ...deptFilter, status: { in: ["FAILED", "UNDONE"] }, updatedAt: { gte: since } } }),
    db().autonomyFeedback.count({ where: { organizationId, companyId, actionClass, ...deptFilter, kind: { in: ["COMPLAINT", "REVERSAL"] }, createdAt: { gte: since } } }),
    db().approval.findMany({
      where: { organizationId, companyId, taskId: { not: null }, status: { in: ["REJECTED", "FAILED"] }, decidedAt: { gte: since } },
      select: { tool: true, requestedByProfile: true, task: { select: { aiEmployee: { select: { department: true } } } } },
      take: 500,
    }),
  ]);
  const { getTool, loadTools } = await import("@/server/modules/tools/registry");
  const { classifyTool } = await import("./autonomy-classes");
  await loadTools();
  let rejected = 0;
  for (const a of approvals) {
    const t = getTool(a.tool);
    if (!t || classifyTool(t) !== actionClass) continue;
    if (department && department !== ALL_DEPARTMENTS && (await approvalDepartment(a)) !== department) continue;
    rejected++;
  }
  return actions + feedback + rejected;
}

/**
 * After a negative signal: if the rule governing this department/class is AUTO and the negatives in the company's
 * window reach its threshold, set the rule back to ASK, audit it and notify everyone who manages the AI workforce.
 * Never throws (a trust check must not break the action that triggered it).
 */
export async function checkDemotion(organizationId: string, companyId: string, department: string, actionClass: ActionClass, signal: NegativeSignal): Promise<boolean> {
  try {
    const rule = await resolveRule(db(), organizationId, companyId, department, actionClass);
    if (rule.level !== "AUTO" || !rule.policyId || actionClass === "read") return false;
    const settings = await companySettings(db(), organizationId, companyId);
    const threshold = settings?.demotionThreshold ?? 3;
    const windowDays = settings?.demotionWindowDays ?? 7;
    const since = new Date(Math.max(Date.now() - windowDays * 86_400_000, (rule.demotedAt?.getTime() ?? 0) + 1));
    // A rule promoted after its last change only counts signals since then.
    const policy = await db().autonomyPolicy.findUnique({ where: { id: rule.policyId }, select: { updatedAt: true } });
    const from = policy && policy.updatedAt > since ? policy.updatedAt : since;
    const count = await negativeSignals(organizationId, companyId, rule.scope, actionClass, from);
    if (count < threshold) return false;
    const reason = `${count} ${signal === "rejection" ? "rejections" : "problems"} (rejections, failures, undos or complaints) in ${windowDays} days`;
    const system = systemContext();
    await transaction(async (tx) => {
      const { count: changed } = await tx.autonomyPolicy.updateMany({ where: { id: rule.policyId!, level: "AUTO" }, data: { level: "ASK", demotedAt: new Date(), demotionReason: reason.slice(0, 300) } });
      if (!changed) return;
      await writeAudit(tx, system, { category: "TENANT", organizationId, action: "autonomy.policy_demoted", resourceType: "autonomy_policy", resourceId: rule.policyId!, oldValue: { level: "AUTO" }, newValue: { companyId, department: rule.scope, actionClass, level: "ASK", reason, signals: count } });
      const recipients = await usersWithPermission(tx, organizationId, companyId, "agents.manage");
      await notifyUsers(tx, organizationId, recipients, "workforce.autonomyDemoted", { companyId, title: `${rule.scope === ALL_DEPARTMENTS ? "company" : rule.scope}: ${actionClass.replace(/_/g, " ")}`, href: "/autonomy" });
    });
    return true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), companyId, actionClass }, "autonomy demotion check failed");
    return false;
  }
}

/** Trust hook for the approvals service: a rejected or failed AI approval may demote its department's AUTO rule. */
export async function noteApprovalOutcome(
  a: { organizationId: string; companyId: string; tool: string; taskId: string | null; requestedByProfile: string | null },
  signal: "rejection" | "failure",
): Promise<void> {
  if (!a.taskId) return;
  try {
    const { getTool, loadTools } = await import("@/server/modules/tools/registry");
    const { classifyTool } = await import("./autonomy-classes");
    await loadTools();
    const t = getTool(a.tool);
    if (!t) return;
    const task = await db().agentTask.findFirst({ where: { id: a.taskId, organizationId: a.organizationId, companyId: a.companyId }, select: { aiEmployee: { select: { department: true } } } });
    const department = await approvalDepartment({ requestedByProfile: a.requestedByProfile, task });
    await checkDemotion(a.organizationId, a.companyId, department, classifyTool(t), signal);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autonomy trust hook failed");
  }
}
