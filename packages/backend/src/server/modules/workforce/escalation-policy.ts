import { db } from "@/server/core/db";

/**
 * Escalation hygiene: what is important enough to climb the org chart. Roll-ups and automatic escalations go
 * manager → executive → CEO, and each step up needs a higher severity, so trivial events never reach the AI CEO (or
 * the founder). Deterministic: computed from stored task rows only.
 */
export const SEVERITIES = ["trivial", "normal", "important", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ESCALATION_THRESHOLDS = {
  /** Minimum severity of an automatic roll-up / failure report filed with the AI CEO (the root executive). */
  ceoMin: "important" as Severity,
  /** Minimum severity of automatic events that notify the founder (manual escalations at the top always do). */
  founderNotifyMin: "important" as Severity,
  /** A roll-up whose executive receiver is not the CEO is copied to the CEO from this severity. */
  climbToCeoMin: "important" as Severity,
  /** Failed tasks of one employee within the window that make a failure important / critical. */
  repeatedFailures: { important: 3, critical: 6, windowMs: 24 * 60 * 60_000 },
  /** Share of failed sub-tasks that makes a team roll-up important; this many failures make it critical. */
  rollupFailureShare: 0.5,
  rollupCriticalFailures: 5,
  /** Hours an AI manager has to resolve an escalation before it climbs one level (by the receiver's level). */
  slaMs: { SPECIALIST: 24 * 60 * 60_000, MANAGER: 24 * 60 * 60_000, EXECUTIVE: 12 * 60 * 60_000 },
} as const;

export const atLeast = (s: Severity, min: Severity) => SEVERITIES.indexOf(s) >= SEVERITIES.indexOf(min);
export const severityOf = (raw: string | null | undefined): Severity => ((SEVERITIES as readonly string[]).includes(raw ?? "") ? (raw as Severity) : "normal");

/** Team roll-up: all done is trivial; some failures normal; many important; a lot critical. */
export function rollupSeverity(total: number, failed: number): Severity {
  if (failed <= 0) return "trivial";
  if (failed >= ESCALATION_THRESHOLDS.rollupCriticalFailures) return "critical";
  if (total > 0 && failed / total >= ESCALATION_THRESHOLDS.rollupFailureShare) return "important";
  return "normal";
}

/** Automatic failure escalation: one failure is normal; repeated failures of the same employee are important / critical. */
export async function failureSeverity(organizationId: string, companyId: string, employeeId: string, now = new Date()): Promise<Severity> {
  const t = ESCALATION_THRESHOLDS.repeatedFailures;
  const n = await db().agentTask.count({ where: { organizationId, companyId, aiEmployeeId: employeeId, status: "FAILED", completedAt: { gte: new Date(now.getTime() - t.windowMs) } } });
  return n >= t.critical ? "critical" : n >= t.important ? "important" : "normal";
}

/** The AI CEO: the root executive of the chart (no AI manager) or the ai_ceo role. */
export async function isCeo(organizationId: string, companyId: string, employeeId: string | null): Promise<boolean> {
  if (!employeeId) return false;
  const e = await db().aiEmployee.findFirst({ where: { id: employeeId, organizationId, companyId }, select: { profileKey: true, level: true, managerEmployeeId: true } });
  return !!e && (e.profileKey === "ai_ceo" || (e.level === "EXECUTIVE" && !e.managerEmployeeId));
}
