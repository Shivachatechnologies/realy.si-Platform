import { db } from "@/server/core/db";
import type { AiAutonomyLevel, AutopilotMode } from "@/generated/prisma/enums";
import { effectiveMode } from "@/server/modules/autopilot/gate";
import type { AutonomyRoom } from "./autonomy-service";

/**
 * One autonomy model (G1, B23). Three stored settings decide how far the AI may go; this maps them onto the
 * directive's four levels and applies one precedence — the most restrictive setting always wins:
 *
 *   1. Platform controls and "Pause all AI"          → nothing runs (PAUSED)
 *   2. Autopilot mode of the department              → may the AI start work on its own? (AutopilotMode)
 *   3. Autonomy rules per action class + Auto mode   → may an action run without approval? (AutonomyPolicy)
 *   4. Each AI employee's autonomy level             → which tools it is offered at all (AiAutonomyLevel)
 *
 * Levels: MANUAL (AI works only when a person asks, and only suggests), ASSISTED (AI drafts and recommends; nothing is
 * filed or done on its own), APPROVAL (AI acts, every change waits for a person's approval), AUTONOMOUS (AI acts on
 * its own within the limits of AUTO rules). Pure mapping plus one read per department; nothing here changes settings.
 */

export const UNIFIED_LEVELS = ["PAUSED", "MANUAL", "ASSISTED", "APPROVAL", "AUTONOMOUS"] as const;
export type UnifiedLevel = (typeof UNIFIED_LEVELS)[number];
const RANK: Record<UnifiedLevel, number> = { PAUSED: 0, MANUAL: 1, ASSISTED: 2, APPROVAL: 3, AUTONOMOUS: 4 };
const lower = (a: UnifiedLevel, b: UnifiedLevel) => (RANK[a] <= RANK[b] ? a : b);

/** Autopilot mode → level (what the department lets the AI start). */
export function levelOfAutopilot(mode: AutopilotMode): UnifiedLevel {
  switch (mode) {
    case "OFF":
      return "PAUSED";
    case "MANUAL":
      return "MANUAL";
    case "ASSISTED":
      return "ASSISTED";
    case "APPROVAL_REQUIRED":
      return "APPROVAL";
    case "AUTONOMOUS":
      return "AUTONOMOUS";
  }
}

/** Autonomy rules of the external action classes → level (Auto rules only count while Auto mode is on). */
export function levelOfRules(levels: string[], autoModeEnabled: boolean): UnifiedLevel {
  if (!levels.length) return "APPROVAL";
  if (autoModeEnabled && levels.includes("AUTO")) return "AUTONOMOUS";
  if (levels.some((l) => l === "ASK" || l === "AUTO")) return "APPROVAL";
  if (levels.includes("SUGGEST")) return "ASSISTED";
  return "MANUAL";
}

/** AI employee autonomy level → level (tool exposure). */
export function levelOfEmployee(level: AiAutonomyLevel): UnifiedLevel {
  switch (level) {
    case "READ_ONLY":
      return "MANUAL";
    case "RECOMMEND":
    case "PREPARE":
      return "ASSISTED";
    case "EXECUTE_WITH_APPROVAL":
      return "APPROVAL";
    case "AUTONOMOUS_LOW_RISK":
      return "AUTONOMOUS";
  }
}

export interface UnifiedDepartment {
  department: string;
  level: UnifiedLevel;
  /** Which setting decided the level (the most restrictive one). */
  decidedBy: "pause" | "autopilot" | "rules" | "employees";
  autopilot: { mode: AutopilotMode; level: UnifiedLevel };
  rules: { level: UnifiedLevel };
  employees: { level: UnifiedLevel | null; count: number };
}

/** The unified level of every department in the control room (company row "*" first). */
export async function unifiedAutonomy(scope: { organizationId: string; companyId: string }, room: AutonomyRoom): Promise<UnifiedDepartment[]> {
  const staff = await db().aiEmployee.findMany({ where: { ...scope, archivedAt: null, status: "ACTIVE" }, select: { department: true, autonomy: true } });
  const out: UnifiedDepartment[] = [];
  for (const d of room.departments) {
    const mode = await effectiveMode(scope, d.key);
    const external = d.rules.filter((r) => r.actionClass !== "read").map((r) => r.rule.level);
    const auto = levelOfAutopilot(mode.mode);
    const rules = levelOfRules(external, room.settings.autoModeEnabled);
    const mine = staff.filter((s) => d.key === "*" || s.department === d.key);
    // The most capable employee bounds what the department's AI can do at all.
    const emp = mine.length ? mine.map((s) => levelOfEmployee(s.autonomy)).reduce((a, b) => (RANK[a] >= RANK[b] ? a : b)) : null;
    let level: UnifiedLevel = room.settings.paused ? "PAUSED" : lower(auto, rules);
    let decidedBy: UnifiedDepartment["decidedBy"] = room.settings.paused ? "pause" : RANK[auto] <= RANK[rules] ? "autopilot" : "rules";
    if (!room.settings.paused && emp && RANK[emp] < RANK[level]) {
      level = emp;
      decidedBy = "employees";
    }
    out.push({ department: d.key, level, decidedBy, autopilot: { mode: mode.mode, level: auto }, rules: { level: rules }, employees: { level: emp, count: mine.length } });
  }
  return out;
}
