import type { AutopilotMode } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { companyClock, companySettings, inWindow, type AutonomyDecision } from "@/server/modules/workforce/autonomy-policy";

/**
 * Company Autopilot gate. One mode per company ("*") and optionally per department, layered on the autonomy policy
 * engine (workforce/autonomy-policy.ts, read-only here):
 *
 *   OFF               no AI work in the scope (person-requested tasks are refused too)
 *   MANUAL            AI works only when a person asks; proactive triggers are refused; actions need approval
 *   ASSISTED          proactive work allowed, but actions are suggestions only (nothing executed or filed)
 *   APPROVAL_REQUIRED proactive work allowed; every action files an approval
 *   AUTONOMOUS        proactive work allowed; the autonomy policy decides (Auto within limits)
 *
 * Without any setting the mode is derived from the existing autonomy settings (Auto mode on → AUTONOMOUS, else
 * APPROVAL_REQUIRED), which reproduces the behaviour before Autopilot existed. Proactive work additionally respects the
 * schedule window (company timezone) and "Pause all AI". Idle by default: AI only runs on an AgentTask, and proactive
 * tasks are only created by a defined business trigger (schedule, department autopilot, event rule, CEO loop).
 */

export const AUTOPILOT_MODES = ["OFF", "MANUAL", "ASSISTED", "APPROVAL_REQUIRED", "AUTONOMOUS"] as const satisfies readonly AutopilotMode[];
export const COMPANY_SCOPE = "*";

export type TriggerKind = "person" | "delegation" | "schedule" | "autopilot" | "event" | "system";
export interface WorkTrigger {
  kind: TriggerKind;
  /** The business trigger, e.g. "schedule:<id>", "ceo-loop", "marketing.autopilot". */
  source: string;
}

const PREFIXES: [RegExp, TriggerKind, string][] = [
  [/^schedule_([0-9a-f-]{36})/, "schedule", "schedule"],
  [/^ceo_/, "autopilot", "ceo-loop"],
  [/^growth_/, "autopilot", "growth"],
  [/^dept_/, "autopilot", "department-manager"],
  [/^escalation_/, "delegation", "escalation"],
  [/^rollup_/, "delegation", "rollup"],
  [/^command_/, "person", "command"],
];

/**
 * Who started this work. Explicit triggers win; otherwise inferred from the request context: background loops use
 * well-known request-id prefixes (workforce schedules, CEO loop, growth, department managers) or the SYSTEM actor
 * (department autopilots, support/marketing automations). Everything else is a person's request.
 */
export function inferTrigger(ctx: RequestContext, opts: { parentTaskId?: string | null; trigger?: WorkTrigger } = {}): WorkTrigger {
  if (opts.trigger) return opts.trigger;
  if (opts.parentTaskId) return { kind: "delegation", source: "delegation" };
  for (const [re, kind, source] of PREFIXES) {
    const m = re.exec(ctx.requestId);
    if (m) return { kind, source: m[1] ? `${source}:${m[1]}` : source };
  }
  if (ctx.actor.type === "SYSTEM") return { kind: "system", source: "system" };
  return { kind: "person", source: "person" };
}

export const isProactive = (t: WorkTrigger) => t.kind === "schedule" || t.kind === "autopilot" || t.kind === "event" || t.kind === "system";

export interface EffectiveMode {
  mode: AutopilotMode;
  /** Where the mode comes from. */
  source: "department" | "company" | "default";
  window: { days: number[]; from: string | null; to: string | null };
  paused: boolean;
  autoModeEnabled: boolean;
  timezone: string | null;
}

type Scope = { organizationId: string; companyId: string };
const cache = new Map<string, { at: number; v: EffectiveMode }>();
const TTL_MS = 15_000;

/** Forget cached modes of a company (after a change in this process). */
export const invalidateAutopilotCache = (companyId: string) => {
  for (const k of cache.keys()) if (k.startsWith(`${companyId}:`)) cache.delete(k);
};

/** The effective mode for a department (or the company with "*"). Fails safe to the derived default. */
export async function effectiveMode(scope: Scope, department: string): Promise<EffectiveMode> {
  const key = `${scope.companyId}:${department}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const [rows, settings, company] = await Promise.all([
    db()
      .autopilotSetting.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, department: { in: [department, COMPANY_SCOPE] } } })
      .catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autopilot settings unavailable; using derived mode");
        return [];
      }),
    companySettings(db(), scope.organizationId, scope.companyId).catch(() => null),
    db().company.findFirst({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { timezone: true } }),
  ]);
  const dept = department === COMPANY_SCOPE ? undefined : rows.find((r) => r.department === department);
  const comp = rows.find((r) => r.department === COMPANY_SCOPE);
  const autoModeEnabled = !!settings?.autoModeEnabled;
  const hasWindow = (r: typeof dept) => !!r && (r.windowDays.length > 0 || !!r.windowFrom);
  const w = hasWindow(dept) ? dept : hasWindow(comp) ? comp : undefined;
  const v: EffectiveMode = {
    mode: dept?.mode ?? comp?.mode ?? (autoModeEnabled ? "AUTONOMOUS" : "APPROVAL_REQUIRED"),
    source: dept ? "department" : comp ? "company" : "default",
    window: { days: w?.windowDays ?? [], from: w?.windowFrom ?? null, to: w?.windowTo ?? null },
    paused: !!settings?.paused,
    autoModeEnabled,
    timezone: company?.timezone ?? null,
  };
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** Is `now` inside the mode's schedule window (company timezone)? */
export function insideWindow(m: Pick<EffectiveMode, "window" | "timezone">, now = new Date()): boolean {
  const clock = companyClock(m.timezone, now);
  if (m.window.days.length && !m.window.days.includes(clock.weekday)) return false;
  return inWindow(clock.time, m.window.from, m.window.to);
}

export type GateReason = "autopilot_off" | "autopilot_manual" | "autopilot_outside_window" | "autopilot_paused";
export type GateResult = { allowed: true; mode: AutopilotMode } | { allowed: false; mode: AutopilotMode; reason: GateReason; message: string };

const GATE_MESSAGES: Record<GateReason, string> = {
  autopilot_off: "Autopilot is off for this department, so the AI does no work here",
  autopilot_manual: "Autopilot is set to Manual for this department: the AI only works when a person asks",
  autopilot_outside_window: "Outside the Autopilot schedule window, so proactive work waits",
  autopilot_paused: "All AI in this company is paused",
};

/** May work start in this department now, given who triggered it? Never writes. */
export async function autopilotGate(scope: Scope, department: string, trigger: WorkTrigger, now = new Date()): Promise<GateResult> {
  const m = await effectiveMode(scope, department);
  const deny = (reason: GateReason): GateResult => ({ allowed: false, mode: m.mode, reason, message: GATE_MESSAGES[reason] });
  if (m.mode === "OFF") return deny("autopilot_off");
  if (!isProactive(trigger)) return { allowed: true, mode: m.mode };
  if (m.paused) return deny("autopilot_paused");
  if (m.mode === "MANUAL") return deny("autopilot_manual");
  if (!insideWindow(m, now)) return deny("autopilot_outside_window");
  return { allowed: true, mode: m.mode };
}

/** Persist one proactive attempt (best effort: the log must never break the work it describes). */
export async function logAutopilotRun(
  scope: Scope,
  e: { department: string; trigger: WorkTrigger; mode: AutopilotMode; status: "STARTED" | "BLOCKED"; reason?: string | null; title?: string | null; taskId?: string | null },
) {
  try {
    await db().autopilotRun.create({
      data: { ...scope, department: e.department, trigger: e.trigger.kind, source: e.trigger.source.slice(0, 120), mode: e.mode, status: e.status, reason: e.reason ?? null, title: e.title?.slice(0, 200) ?? null, taskId: e.taskId ?? null },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autopilot run not logged");
  }
}

/** The proactive trigger a queued task was started by (null = a person's or a delegated task). */
export async function proactiveTriggerOf(taskId: string): Promise<WorkTrigger | null> {
  const r = await db().autopilotRun.findFirst({ where: { taskId, status: "STARTED" }, select: { trigger: true, source: true } }).catch(() => null);
  return r ? { kind: r.trigger as TriggerKind, source: r.source } : null;
}

/** The ceiling a mode puts on tool actions: null = the autonomy policy decides alone. */
export function toolCeiling(mode: AutopilotMode): "deny" | "suggest" | "ask" | null {
  if (mode === "OFF") return "deny";
  if (mode === "ASSISTED") return "suggest";
  if (mode === "MANUAL" || mode === "APPROVAL_REQUIRED") return "ask";
  return null;
}

/** Narrow an autonomy decision by the department's Autopilot mode (never widens it). Reads are never narrowed except by OFF. */
export function applyAutopilotCeiling(d: AutonomyDecision, mode: AutopilotMode, isRead: boolean): AutonomyDecision {
  const ceiling = toolCeiling(mode);
  if (!ceiling || d.decision === "deny") return d;
  if (ceiling === "deny") return { ...d, decision: "deny", reason: "policy_off", message: GATE_MESSAGES.autopilot_off };
  if (isRead) return d;
  if (ceiling === "suggest") return { ...d, decision: "deny", reason: "policy_suggest", message: "Autopilot is set to Assisted for this department: the AI suggests, a person acts" };
  if (d.decision === "auto") return { ...d, decision: "ask", reason: "policy_ask", message: "Autopilot requires a person's approval for actions in this department" };
  return d;
}
