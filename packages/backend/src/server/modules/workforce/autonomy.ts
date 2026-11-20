import type { AiAutonomyLevel } from "@/generated/prisma/enums";
import { getTool } from "@/server/modules/tools/registry";

export const AUTONOMY_LEVELS = ["READ_ONLY", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL", "AUTONOMOUS_LOW_RISK"] as const satisfies readonly AiAutonomyLevel[];

/** Autonomous tools that still create work (internal writes); a read-only employee is not offered them. */
const INTERNAL_WRITES = new Set(["delegate_to_ai_employee", "escalate_to_manager", "report_to_manager"]);

/**
 * Which of an employee's tools are offered at an autonomy level. This only narrows the offer: every call still goes
 * through the tool gateway, so permissions always apply and SUPERVISED tools file approvals unless the company's
 * autonomy policy (./autonomy-policy.ts, docs/autonomy.md) lets their department act on its own within limits.
 */
export function toolsForAutonomy(tools: readonly string[], level: AiAutonomyLevel): string[] {
  return tools.filter((name) => {
    const t = getTool(name);
    if (!t) return false;
    switch (level) {
      case "READ_ONLY":
        return t.autonomy === "AUTONOMOUS" && !INTERNAL_WRITES.has(name);
      case "RECOMMEND":
        // Suggest-only: may report and escalate, but never hands work to others.
        return t.autonomy === "AUTONOMOUS" && name !== "delegate_to_ai_employee";
      case "PREPARE":
        return t.autonomy === "AUTONOMOUS" || (t.autonomy === "SUPERVISED" && (t.risk === "LOW" || t.risk === "MEDIUM"));
      case "EXECUTE_WITH_APPROVAL":
      case "AUTONOMOUS_LOW_RISK":
        return true;
    }
  });
}

/** Prompt guidance per autonomy level (appended to the employee's role). */
export const AUTONOMY_GUIDANCE: Record<AiAutonomyLevel, string> = {
  READ_ONLY: "Autonomy: read-only. Look things up and report findings; do not propose changes or delegate work.",
  RECOMMEND: "Autonomy: recommend. Analyse and give clear, prioritised recommendations for a person to act on; do not propose changes yourself.",
  PREPARE: "Autonomy: prepare. Prepare drafts and propose internal changes (each is filed for approval); external actions are not available to you.",
  EXECUTE_WITH_APPROVAL: "Autonomy: execute with approval. You may propose any action your tools allow; each change is filed for a person's approval before it happens, unless the company's Auto mode policy allows it (the tool result says which).",
  AUTONOMOUS_LOW_RISK:
    "Autonomy: autonomous for low-risk work. Carry the task through end to end without asking for clarification; make reasonable, stated assumptions. Actions that change data are filed for approval unless the company's Auto mode policy allows them; the tool result says which.",
};

/** The three plain-language autonomy modes the levels fall into (UI grouping). */
export type AutonomyMode = "suggest" | "supervised" | "autonomous";
export const AUTONOMY_MODE: Record<AiAutonomyLevel, AutonomyMode> = {
  READ_ONLY: "suggest",
  RECOMMEND: "suggest",
  PREPARE: "supervised",
  EXECUTE_WITH_APPROVAL: "supervised",
  AUTONOMOUS_LOW_RISK: "autonomous",
};

/**
 * How delegate_to_ai_employee behaves for an employee: supervised employees only propose a delegation (a person
 * approves it before any work starts); autonomous ones create the sub-task directly, within the depth, fan-out and
 * budget limits (workforce/delegation.ts). Suggest-only employees are not offered the tool at all.
 */
export const delegationMode = (level: AiAutonomyLevel): "propose" | "direct" => (level === "AUTONOMOUS_LOW_RISK" ? "direct" : "propose");
