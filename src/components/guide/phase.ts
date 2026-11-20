import { toolVerb } from "./tool-labels";

/** Visual state of AI work, derived only from the real task status, its trace and its delegated child tasks. */
export type WorkPhase = "thinking" | "planning" | "executing" | "collaborating" | "completing" | "done" | "failed" | "cancelled";

export function workPhase(task: { status: string; trace: { tool: string }[]; output?: string | null }, children: { status: string }[] = []): WorkPhase {
  if (task.status === "FAILED") return "failed";
  if (task.status === "CANCELLED") return "cancelled";
  if (task.status === "COMPLETED") return task.output ? "done" : "completing";
  if (children.some((c) => c.status === "QUEUED" || c.status === "RUNNING")) return "collaborating";
  if (task.status === "QUEUED" || task.trace.length === 0) return "thinking";
  const acting = task.trace.some((s) => !["read", "search"].includes(toolVerb(s.tool)));
  return acting ? "executing" : "planning";
}

export const ACTIVE_PHASES: WorkPhase[] = ["thinking", "planning", "executing", "collaborating", "completing"];
export const isActive = (status: string) => status === "QUEUED" || status === "RUNNING";
