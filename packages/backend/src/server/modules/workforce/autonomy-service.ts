import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { getControls, getOrgOverride } from "@/server/core/platform-controls";
import { minorUnits } from "@/i18n/format";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { mfaSatisfied, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { authorizeTool, ToolDenied, withTimeout } from "@/server/modules/tools/gateway";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import {
  ACTION_CLASSES,
  ALL_DEPARTMENTS,
  AUTONOMY_CHANNELS,
  AUTONOMY_DEPARTMENTS,
  AUTONOMY_LEVEL_KEYS,
  DEFAULT_LEVEL,
  EXTERNAL_CLASSES,
  MONEY_CLASSES,
  NEVER_AUTO,
  PAYMENT_HARD_CAP_MAJOR,
  classifyTool,
  type ActionClass,
  type AutonomyLevelKey,
} from "./autonomy-classes";
import { checkDemotion, companyClock, paymentHardCapMinor, ruleOf, type AutonomyRule } from "./autonomy-policy";

/**
 * The /autonomy control room (docs/autonomy.md): policies per company → department → action class, the company Auto
 * mode switch and "Pause all AI", the trust record of every AI department, promotion recommendations, and the log of
 * auto-approved actions with undo. Reads need agents.read; every change needs agents.manage, and turning anything
 * external to Auto (or Auto mode on) needs a fresh two-factor verification.
 */

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const TRUST_DAYS = 30;
/** Promotion: at least this many approvals in TRUST_DAYS with no rejections, failures or complaints. */
const PROMOTE_MIN_APPROVED = 20;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

function personId(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw invalid("Only a person can change autonomy settings");
  return ctx.actor.id;
}

const departmentKey = z.union([z.enum(AUTONOMY_DEPARTMENTS), z.literal(ALL_DEPARTMENTS)]);
const major = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, "Enter an amount like 250 or 99.50");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Major-unit decimal string → minor units, exact (no floating point). */
function toMinor(value: string, currency: string): bigint {
  const digits = minorUnits(currency);
  const [whole, frac = ""] = value.split(".");
  if (frac.length > digits) throw invalid(`At most ${digits} decimals for ${currency}`, { reason: "workforce_autonomy_amount" });
  return BigInt(whole!) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
}

// ───────────── Read model ─────────────

export interface TrustLine {
  department: string;
  actionClass: ActionClass;
  approved: number;
  rejected: number;
  failed: number;
  autoDone: number;
  undone: number;
  edited: number;
  complaints: number;
  reversals: number;
  /** Highest number of approved/auto actions on one day (sizes a recommended daily cap). */
  peakDay: number;
  employees: { id: string; name: string; approved: number; rejected: number; autoDone: number; problems: number }[];
}

export interface Recommendation {
  department: string;
  actionClass: ActionClass;
  approved: number;
  rejected: number;
  edited: number;
  days: number;
  dailyLimit: number;
}

const zeroLine = (department: string, actionClass: ActionClass): TrustLine & { _days: Map<string, number>; _emps: Map<string, TrustLine["employees"][number]> } => ({
  department,
  actionClass,
  approved: 0,
  rejected: 0,
  failed: 0,
  autoDone: 0,
  undone: 0,
  edited: 0,
  complaints: 0,
  reversals: 0,
  peakDay: 0,
  employees: [],
  _days: new Map(),
  _emps: new Map(),
});

/** Each AI department's record per action class over the last `days` days (approvals, autonomous runs, feedback). */
export async function trustRecords(organizationId: string, companyId: string, days = TRUST_DAYS): Promise<TrustLine[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [approvals, actions, feedback] = await Promise.all([
    db().approval.findMany({
      where: { organizationId, companyId, taskId: { not: null }, createdAt: { gte: since } },
      select: { tool: true, status: true, createdAt: true, requestedByProfile: true, task: { select: { aiEmployee: { select: { id: true, name: true, department: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    db().autonomousAction.findMany({
      where: { organizationId, companyId, createdAt: { gte: since } },
      select: { department: true, actionClass: true, status: true, aiEmployeeId: true, createdAt: true },
      take: 10_000,
    }),
    db().autonomyFeedback.findMany({ where: { organizationId, companyId, createdAt: { gte: since } }, select: { department: true, actionClass: true, kind: true, aiEmployeeId: true }, take: 5000 }),
  ]);
  await loadTools();
  const { profileByKey } = await import("@/server/modules/agents/profiles");
  const empIds = [...new Set(actions.map((a) => a.aiEmployeeId).filter((x): x is string => !!x))];
  const names = new Map((await db().aiEmployee.findMany({ where: { organizationId, companyId, id: { in: empIds } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  for (const a of approvals) if (a.task?.aiEmployee) names.set(a.task.aiEmployee.id, a.task.aiEmployee.name);

  const lines = new Map<string, ReturnType<typeof zeroLine>>();
  const line = (department: string, actionClass: ActionClass) => {
    const k = `${department}|${actionClass}`;
    let l = lines.get(k);
    if (!l) lines.set(k, (l = zeroLine(department, actionClass)));
    return l;
  };
  const emp = (l: ReturnType<typeof zeroLine>, id: string | null | undefined) => {
    if (!id) return null;
    let e = l._emps.get(id);
    if (!e) l._emps.set(id, (e = { id, name: names.get(id) ?? "—", approved: 0, rejected: 0, autoDone: 0, problems: 0 }));
    return e;
  };
  const bumpDay = (l: ReturnType<typeof zeroLine>, at: Date) => {
    const d = at.toISOString().slice(0, 10);
    l._days.set(d, (l._days.get(d) ?? 0) + 1);
  };

  for (const a of approvals) {
    const t = getTool(a.tool);
    if (!t) continue;
    const cls = classifyTool(t);
    if (cls === "read") continue;
    const dept = a.task?.aiEmployee?.department ?? ((a.requestedByProfile && profileByKey(a.requestedByProfile)?.department) || "operations");
    const l = line(dept, cls);
    const e = emp(l, a.task?.aiEmployee?.id);
    if (a.status === "EXECUTED" || a.status === "APPROVED") {
      l.approved++;
      if (e) e.approved++;
      bumpDay(l, a.createdAt);
    } else if (a.status === "REJECTED") {
      l.rejected++;
      if (e) e.rejected++;
    } else if (a.status === "FAILED") {
      l.failed++;
      if (e) e.problems++;
    }
  }
  for (const a of actions) {
    const l = line(a.department, a.actionClass as ActionClass);
    const e = emp(l, a.aiEmployeeId);
    if (a.status === "EXECUTED" || a.status === "RUNNING") {
      l.autoDone++;
      if (e) e.autoDone++;
      bumpDay(l, a.createdAt);
    } else if (a.status === "FAILED") {
      l.failed++;
      if (e) e.problems++;
    } else if (a.status === "UNDONE") {
      l.autoDone++;
      l.undone++;
      if (e) e.problems++;
    }
  }
  for (const f of feedback) {
    const l = line(f.department, f.actionClass as ActionClass);
    const e = emp(l, f.aiEmployeeId);
    if (f.kind === "EDITED") l.edited++;
    else if (f.kind === "COMPLAINT") l.complaints++;
    else l.reversals++;
    if (e && f.kind !== "EDITED") e.problems++;
  }
  return [...lines.values()].map(({ _days, _emps, ...l }) => ({ ...l, peakDay: Math.max(0, ..._days.values()), employees: [..._emps.values()].sort((a, b) => b.approved + b.autoDone - (a.approved + a.autoDone)) }));
}

/** A spotless record at "Ask me" earns a recommendation to switch to Auto with a daily cap. Never for hard floors or money. */
export function recommendationsFrom(trust: TrustLine[], effective: (department: string, cls: ActionClass) => AutonomyRule): Recommendation[] {
  const out: Recommendation[] = [];
  for (const l of trust) {
    if (l.actionClass === "read" || NEVER_AUTO.includes(l.actionClass) || MONEY_CLASSES.includes(l.actionClass)) continue;
    if (effective(l.department, l.actionClass).level !== "ASK") continue;
    if (l.approved < PROMOTE_MIN_APPROVED || l.rejected > 0 || l.failed > 0 || l.complaints > 0 || l.reversals > 0 || l.undone > 0) continue;
    if (l.edited > Math.floor(l.approved * 0.1)) continue;
    const cap = Math.min(200, Math.max(5, Math.ceil((Math.max(l.peakDay, Math.ceil(l.approved / TRUST_DAYS)) * 2) / 5) * 5));
    out.push({ department: l.department, actionClass: l.actionClass, approved: l.approved, rejected: l.rejected, edited: l.edited, days: TRUST_DAYS, dailyLimit: cap });
  }
  return out.sort((a, b) => b.approved - a.approved);
}

function effectiveFrom(rows: Prisma.AutonomyPolicyGetPayload<object>[]) {
  return (department: string, cls: ActionClass): AutonomyRule & { inherited: boolean } => {
    const own = rows.find((r) => r.department === department && r.actionClass === cls);
    if (own) return { ...ruleOf(own), inherited: false };
    const all = rows.find((r) => r.department === ALL_DEPARTMENTS && r.actionClass === cls);
    if (all) return { ...ruleOf(all), inherited: department !== ALL_DEPARTMENTS };
    return {
      policyId: null,
      scope: null,
      level: DEFAULT_LEVEL[cls],
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
      inherited: true,
    };
  };
}

const wireRule = (r: AutonomyRule & { inherited: boolean }) => ({
  policyId: r.policyId,
  scope: r.scope,
  inherited: r.inherited,
  level: r.level,
  dailyLimit: r.dailyLimit,
  perActionMaxMinor: r.perActionMaxMinor?.toString() ?? null,
  dailyMaxMinor: r.dailyMaxMinor?.toString() ?? null,
  monthlyMaxMinor: r.monthlyMaxMinor?.toString() ?? null,
  currency: r.currency,
  hoursFrom: r.hoursFrom,
  hoursTo: r.hoursTo,
  allowedDays: r.allowedDays,
  allowedChannels: r.allowedChannels,
  demotedAt: r.demotedAt?.toISOString() ?? null,
  demotionReason: r.demotionReason,
});
export type WireRule = ReturnType<typeof wireRule>;

/** Everything the /autonomy page shows. */
export async function getAutonomyRoom(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { timezone: true, baseCurrency: true } });
  if (!company) throw notFound("Company");
  const clock = companyClock(company.timezone);
  const [settings, rows, staff, usageToday, moneyToday, log, trust, controls, override, last24h] = await Promise.all([
    db().autonomySettings.findUnique({ where: { companyId } }),
    db().autonomyPolicy.findMany({ where: { organizationId, companyId } }),
    db().aiEmployee.groupBy({ by: ["department"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
    db().autonomousAction.groupBy({ by: ["department", "actionClass"], where: { organizationId, companyId, day: clock.day, status: { in: ["RUNNING", "EXECUTED"] } }, _count: { _all: true } }),
    db().autonomousAction.groupBy({ by: ["department", "actionClass", "currency"], where: { organizationId, companyId, day: clock.day, status: { in: ["RUNNING", "EXECUTED"] }, amountMinor: { not: null } }, _sum: { amountMinor: true } }),
    db().autonomousAction.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 60 }),
    trustRecords(organizationId, companyId),
    getControls(),
    getOrgOverride(organizationId),
    db().autonomousAction.count({ where: { organizationId, companyId, createdAt: { gte: new Date(Date.now() - 86_400_000) }, status: { in: ["RUNNING", "EXECUTED", "UNDONE"] } } }),
  ]);
  const effective = effectiveFrom(rows);
  const deptSet = new Set<string>([...staff.map((s) => s.department), ...rows.map((r) => r.department), ...trust.map((t) => t.department)]);
  const departments = AUTONOMY_DEPARTMENTS.filter((d) => deptSet.has(d));
  const used = (dept: string, cls: string) => usageToday.find((u) => u.department === dept && u.actionClass === cls)?._count._all ?? 0;
  const empIds = [...new Set(log.map((l) => l.aiEmployeeId).filter((x): x is string => !!x))];
  const empNames = new Map((await db().aiEmployee.findMany({ where: { organizationId, companyId, id: { in: empIds } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  const scopes = [ALL_DEPARTMENTS, ...departments];
  return {
    timezone: company.timezone,
    baseCurrency: company.baseCurrency,
    paymentHardCapMinor: paymentHardCapMinor(company.baseCurrency).toString(),
    /** Actions the AI took on its own in the last 24 hours. */
    autoLast24h: last24h,
    settings: {
      autoModeEnabled: settings?.autoModeEnabled ?? false,
      paused: settings?.paused ?? false,
      pausedAt: settings?.pausedAt?.toISOString() ?? null,
      pauseReason: settings?.pauseReason ?? null,
      demotionThreshold: settings?.demotionThreshold ?? 3,
      demotionWindowDays: settings?.demotionWindowDays ?? 7,
    },
    platform: {
      aiEnabled: controls.aiWorkforceEnabled && !override.aiDisabled,
      executionPaused: controls.aiExecutionPaused || controls.readOnlyMode || controls.maintenanceMode || !!controls.lockdown,
      supervised: controls.aiAutonomyCeiling !== "full" || controls.aiRequireApprovalForWrites,
    },
    departments: scopes.map((d) => ({
      key: d,
      employees: d === ALL_DEPARTMENTS ? staff.reduce((s, x) => s + x._count._all, 0) : (staff.find((s) => s.department === d)?._count._all ?? 0),
      rules: ACTION_CLASSES.map((cls) => ({
        actionClass: cls,
        rule: wireRule(effective(d, cls)),
        usedToday: d === ALL_DEPARTMENTS ? usageToday.filter((u) => u.actionClass === cls).reduce((s, u) => s + u._count._all, 0) : used(d, cls),
        spentToday: moneyToday
          .filter((m) => m.actionClass === cls && (d === ALL_DEPARTMENTS || m.department === d))
          .map((m) => ({ currency: m.currency ?? company.baseCurrency, amountMinor: (m._sum.amountMinor ?? 0n).toString() })),
      })),
    })),
    trust,
    recommendations: recommendationsFrom(trust, effective),
    demotions: rows.filter((r) => r.demotedAt && r.level === "ASK" && Date.now() - r.demotedAt.getTime() < TRUST_DAYS * 86_400_000).map((r) => ({ department: r.department, actionClass: r.actionClass as ActionClass, at: r.demotedAt!.toISOString(), reason: r.demotionReason })),
    log: log.map((a) => ({
      id: a.id,
      department: a.department,
      actionClass: a.actionClass as ActionClass,
      tool: a.tool,
      source: a.source,
      summary: a.summary,
      status: a.status,
      channel: a.channel,
      amountMinor: a.amountMinor?.toString() ?? null,
      currency: a.currency,
      employee: a.aiEmployeeId ? (empNames.get(a.aiEmployeeId) ?? null) : null,
      taskId: a.taskId,
      policyScope: (a.policySnapshot as { scope?: string | null } | null)?.scope ?? null,
      reversible: a.status === "EXECUTED" && !!a.undo,
      error: a.error,
      createdAt: a.createdAt.toISOString(),
      undoneAt: a.undoneAt?.toISOString() ?? null,
    })),
  };
}
export type AutonomyRoom = Awaited<ReturnType<typeof getAutonomyRoom>>;

// ───────────── Policies ─────────────

export const policyInput = z.object({
  department: departmentKey,
  actionClass: z.enum(ACTION_CLASSES),
  /** null = remove this rule (a department falls back to the company-wide rule, the company to the default). */
  level: z.enum(AUTONOMY_LEVEL_KEYS).nullable(),
  dailyLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  /** Money caps in major units of `currency` (e.g. "250" or "99.50"). */
  perActionMax: major.nullable().optional(),
  dailyMax: major.nullable().optional(),
  monthlyMax: major.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  hoursFrom: hhmm.nullable().optional(),
  hoursTo: hhmm.nullable().optional(),
  allowedDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  allowedChannels: z.array(z.enum(AUTONOMY_CHANNELS)).max(AUTONOMY_CHANNELS.length).optional(),
});

/** Refuses combinations the hard floors forbid (UI shows them as locked; this is the server-side guarantee). */
function validateRule(cls: ActionClass, level: AutonomyLevelKey, data: { perActionMaxMinor: bigint | null; currency: string; hoursFrom: string | null; hoursTo: string | null }) {
  if (cls === "read" && (level === "SUGGEST" || level === "ASK")) throw invalid("Looking things up is either on or off", { reason: "workforce_autonomy_read_level" });
  if (level !== "AUTO") return;
  if (NEVER_AUTO.includes(cls)) throw invalid("This kind of action always needs a person", { reason: "workforce_autonomy_hard_floor" });
  if (MONEY_CLASSES.includes(cls) && data.perActionMaxMinor === null) throw invalid("Set a per-action limit before money can move automatically", { reason: "workforce_autonomy_cap_required" });
  if (cls === "pay" && data.perActionMaxMinor !== null && data.perActionMaxMinor > paymentHardCapMinor(data.currency)) {
    throw invalid(`Automatic payments are limited to ${PAYMENT_HARD_CAP_MAJOR} ${data.currency} each`, { reason: "workforce_autonomy_payment_cap" });
  }
  if ((data.hoursFrom === null) !== (data.hoursTo === null)) throw invalid("Set both a start and an end time, or neither", { reason: "workforce_autonomy_hours" });
}

/** Set (or remove) one rule. Raising an external class to Auto needs a fresh two-factor verification. */
export async function setAutonomyPolicy(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof policyInput>) {
  const input = policyInput.parse(raw);
  const actorId = personId(ctx);
  const cls = input.actionClass;
  if (input.level === "AUTO" && EXTERNAL_CLASSES.includes(cls) && !mfaSatisfied(ctx)) {
    throw new AppError("mfa_required", "Letting the AI act on its own outside the company requires a recent two-factor verification");
  }
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const before = await tx.autonomyPolicy.findUnique({ where: { companyId_department_actionClass: { companyId, department: input.department, actionClass: cls } } });
    const oldValue = before ? { level: before.level, dailyLimit: before.dailyLimit, perActionMaxMinor: before.perActionMaxMinor?.toString() ?? null } : null;
    if (input.level === null) {
      if (before) await tx.autonomyPolicy.delete({ where: { id: before.id } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "autonomy.policy_removed", resourceType: "autonomy_policy", resourceId: before?.id ?? `${input.department}:${cls}`, oldValue, newValue: { companyId, department: input.department, actionClass: cls } });
      return { removed: true };
    }
    const currency = input.currency ?? company.baseCurrency;
    const m = (v: string | null | undefined) => (v ? toMinor(v, currency) : null);
    const data = {
      level: input.level,
      dailyLimit: input.dailyLimit ?? null,
      perActionMaxMinor: m(input.perActionMax),
      dailyMaxMinor: m(input.dailyMax),
      monthlyMaxMinor: m(input.monthlyMax),
      currency,
      hoursFrom: input.hoursFrom ?? null,
      hoursTo: input.hoursTo ?? null,
      allowedDays: [...new Set(input.allowedDays ?? [])].sort(),
      allowedChannels: [...new Set(input.allowedChannels ?? [])],
      updatedById: actorId,
      // A person setting the rule again clears the trust system's demotion marker.
      demotedAt: null,
      demotionReason: null,
    };
    validateRule(cls, input.level, data);
    const row = await tx.autonomyPolicy.upsert({
      where: { companyId_department_actionClass: { companyId, department: input.department, actionClass: cls } },
      create: { organizationId, companyId, department: input.department, actionClass: cls, ...data },
      update: data,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "autonomy.policy_set",
      resourceType: "autonomy_policy",
      resourceId: row.id,
      oldValue,
      newValue: { companyId, department: input.department, actionClass: cls, level: data.level, dailyLimit: data.dailyLimit, perActionMaxMinor: data.perActionMaxMinor?.toString() ?? null, dailyMaxMinor: data.dailyMaxMinor?.toString() ?? null, monthlyMaxMinor: data.monthlyMaxMinor?.toString() ?? null, currency, hoursFrom: data.hoursFrom, hoursTo: data.hoursTo, allowedDays: data.allowedDays, allowedChannels: data.allowedChannels },
    });
    return { removed: false, id: row.id };
  });
}

export const applyRecommendationInput = z.object({ department: departmentKey, actionClass: z.enum(ACTION_CLASSES) });

/** One click: apply a current promotion recommendation (recomputed here, never trusted from the client). */
export async function applyRecommendation(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof applyRecommendationInput>) {
  const input = applyRecommendationInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.manage");
  const rows = await db().autonomyPolicy.findMany({ where: { organizationId, companyId } });
  const rec = recommendationsFrom(await trustRecords(organizationId, companyId), effectiveFrom(rows)).find((r) => r.department === input.department && r.actionClass === input.actionClass);
  if (!rec) throw conflict("This recommendation no longer applies", { reason: "workforce_autonomy_no_recommendation" });
  const current = effectiveFrom(rows)(input.department, input.actionClass);
  return setAutonomyPolicy(ctx, organizationId, companyId, {
    department: input.department,
    actionClass: input.actionClass,
    level: "AUTO",
    dailyLimit: rec.dailyLimit,
    hoursFrom: current.hoursFrom,
    hoursTo: current.hoursTo,
    allowedDays: current.allowedDays,
    allowedChannels: current.allowedChannels.filter((c): c is (typeof AUTONOMY_CHANNELS)[number] => (AUTONOMY_CHANNELS as readonly string[]).includes(c)),
  });
}

// ───────────── Company switches ─────────────

export const settingsInput = z.object({
  autoModeEnabled: z.boolean().optional(),
  demotionThreshold: z.number().int().min(1).max(50).optional(),
  demotionWindowDays: z.number().int().min(1).max(90).optional(),
});

export async function setAutonomySettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  const actorId = personId(ctx);
  if (input.autoModeEnabled && !mfaSatisfied(ctx)) throw new AppError("mfa_required", "Turning on Auto mode requires a recent two-factor verification");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.autonomySettings.findUnique({ where: { companyId } });
    const row = await tx.autonomySettings.upsert({ where: { companyId }, create: { organizationId, companyId, ...input, updatedById: actorId }, update: { ...input, updatedById: actorId } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "autonomy.settings_changed",
      resourceType: "autonomy_settings",
      resourceId: row.id,
      oldValue: before ? { autoModeEnabled: before.autoModeEnabled, demotionThreshold: before.demotionThreshold, demotionWindowDays: before.demotionWindowDays } : null,
      newValue: { companyId, autoModeEnabled: row.autoModeEnabled, demotionThreshold: row.demotionThreshold, demotionWindowDays: row.demotionWindowDays },
    });
    return { autoModeEnabled: row.autoModeEnabled };
  });
}

export const pauseInput = z.object({ paused: z.boolean(), reason: z.string().trim().max(500).optional() });

/**
 * "Pause all AI" for this company: no AI task starts (createTask, the worker) and no tool acts (gateway) until
 * resumed. Platform kill switches (Admin) still apply on top. Everyone who manages the AI workforce is notified.
 */
export async function setCompanyAiPaused(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof pauseInput>) {
  const input = pauseInput.parse(raw);
  const actorId = personId(ctx);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const data = input.paused ? { paused: true, pausedAt: new Date(), pausedById: actorId, pauseReason: input.reason || null } : { paused: false, pausedAt: null, pausedById: null, pauseReason: null };
    const row = await tx.autonomySettings.upsert({ where: { companyId }, create: { organizationId, companyId, ...data, updatedById: actorId }, update: { ...data, updatedById: actorId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.paused ? "autonomy.ai_paused" : "autonomy.ai_resumed", resourceType: "autonomy_settings", resourceId: row.id, newValue: { companyId, reason: input.reason ?? null }, reason: input.reason ?? null });
    const recipients = (await usersWithPermission(tx, organizationId, companyId, "agents.manage")).filter((u) => u !== actorId);
    await notifyUsers(tx, organizationId, recipients, input.paused ? "workforce.autonomyPaused" : "workforce.autonomyResumed", { companyId, title: input.reason || "—", href: "/autonomy" });
    return { paused: row.paused };
  });
}

// ───────────── Undo and feedback ─────────────

/**
 * Undo an auto-approved action: runs its recorded reversal (another registered tool) as the person clicking, with
 * their permissions, then marks the action UNDONE. A reversal is a trust signal and may demote the rule.
 */
export async function undoAutonomousAction(ctx: RequestContext, organizationId: string, companyId: string, actionId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  const actorId = personId(ctx);
  if (!isUuid(actionId)) throw notFound("Action");
  const a = await db().autonomousAction.findFirst({ where: { id: actionId, organizationId, companyId } });
  if (!a) throw notFound("Action");
  const plan = z.object({ tool: z.string(), input: z.unknown() }).safeParse(a.undo);
  if (a.status !== "EXECUTED" || !plan.success) throw conflict("This action cannot be undone", { reason: "workforce_autonomy_not_reversible" });
  await loadTools();
  const tool = getTool(plan.data.tool);
  if (!tool) throw conflict("The undo step is no longer available", { reason: "workforce_autonomy_not_reversible" });
  const parsed = tool.input.safeParse(plan.data.input);
  if (!parsed.success) throw conflict("The undo step is no longer valid", { reason: "workforce_autonomy_not_reversible" });
  try {
    await authorizeTool(tool, ctx, organizationId, companyId);
  } catch (err) {
    if (isAppError(err) && err.code === "mfa_required") throw err;
    throw new AppError("forbidden", "You lack the permission this undo needs", { reason: "workforce_autonomy_undo_forbidden", permissions: tool.permissions });
  }
  if ((tool.risk === "HIGH" || tool.risk === "CRITICAL") && !mfaSatisfied(ctx)) throw new AppError("mfa_required", "This undo requires a recent two-factor verification");
  // Claim first so two clicks can never reverse twice.
  const { count } = await db().autonomousAction.updateMany({ where: { id: a.id, status: "EXECUTED" }, data: { status: "UNDONE", undoneAt: new Date(), undoneById: actorId } });
  if (!count) throw conflict("This action was already undone", { reason: "workforce_autonomy_not_reversible" });
  try {
    const out = await withTimeout(tool.execute(parsed.data, { ctx, organizationId, companyId }), tool.timeoutMs);
    await transaction(async (tx) => {
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "autonomy.action_undone", resourceType: "autonomous_action", resourceId: a.id, newValue: { companyId, undoTool: tool.name, records: out.records ?? [] } });
    });
  } catch (err) {
    await db().autonomousAction.updateMany({ where: { id: a.id, status: "UNDONE" }, data: { status: "EXECUTED", undoneAt: null, undoneById: null } });
    const message = err instanceof ToolDenied ? err.message : isAppError(err) && err.code !== "internal_error" ? err.message : "The undo failed";
    throw new AppError("conflict", `Could not undo: ${message}`, { reason: "workforce_autonomy_undo_failed" });
  }
  await checkDemotion(organizationId, companyId, a.department, a.actionClass as ActionClass, "reversal");
  return { id: a.id, status: "UNDONE" as const };
}

export const feedbackInput = z.object({
  kind: z.enum(["EDITED", "COMPLAINT", "REVERSAL"]),
  note: z.string().trim().max(1000).optional(),
});

/** A person flags a problem with an auto-approved action (complaint, reversal elsewhere, or edits needed). */
export async function reportAutonomyProblem(ctx: RequestContext, organizationId: string, companyId: string, actionId: string, raw: z.input<typeof feedbackInput>) {
  const input = feedbackInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!isUuid(actionId)) throw notFound("Action");
  const a = await db().autonomousAction.findFirst({ where: { id: actionId, organizationId, companyId }, select: { id: true, department: true, actionClass: true, aiEmployeeId: true } });
  if (!a) throw notFound("Action");
  return recordAutonomyFeedback(ctx, organizationId, companyId, { department: a.department, actionClass: a.actionClass as ActionClass, kind: input.kind, note: input.note, aiEmployeeId: a.aiEmployeeId, autonomousActionId: a.id, source: "autonomy" });
}

/**
 * Record a trust signal (for other modules too: e.g. support records a COMPLAINT about an AI email, a module records
 * EDITED when a person changed an AI draft before sending). Complaints and reversals may demote the rule.
 * Callers must have authorized the action they are reporting on.
 */
export async function recordAutonomyFeedback(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  f: { department: string; actionClass: ActionClass; kind: "EDITED" | "COMPLAINT" | "REVERSAL"; note?: string | null; aiEmployeeId?: string | null; autonomousActionId?: string | null; approvalId?: string | null; source?: string | null },
) {
  const row = await transaction(async (tx) => {
    const r = await tx.autonomyFeedback.create({
      data: {
        organizationId,
        companyId,
        department: f.department,
        actionClass: f.actionClass,
        kind: f.kind,
        note: f.note?.slice(0, 1000) || null,
        aiEmployeeId: f.aiEmployeeId ?? null,
        autonomousActionId: f.autonomousActionId ?? null,
        approvalId: f.approvalId ?? null,
        source: f.source ?? null,
        createdById: ctx.actor.type === "USER" ? ctx.actor.id : null,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "autonomy.feedback_recorded", resourceType: "autonomy_feedback", resourceId: r.id, newValue: { companyId, department: f.department, actionClass: f.actionClass, kind: f.kind, autonomousActionId: f.autonomousActionId ?? null } });
    return r;
  });
  if (f.kind !== "EDITED") await checkDemotion(organizationId, companyId, f.department, f.actionClass, f.kind === "COMPLAINT" ? "complaint" : "reversal");
  return { id: row.id };
}
