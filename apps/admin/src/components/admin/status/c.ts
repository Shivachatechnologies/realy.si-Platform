import type { StatusToneMap } from "./types";

/** Stream C — AI tasks, AI requests, employees, workflows, runs, knowledge, budgets. */
export const tonesC: StatusToneMap = {
  aiTask: { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral", WAITING_APPROVAL: "warning", PAUSED: "warning" },
  aiRequest: { SUCCESS: "success", ERROR: "danger", FALLBACK: "warning", REFUSED: "danger", BUDGET_BLOCKED: "warning", CACHED: "info" },
  aiEmployee: { ACTIVE: "success", PAUSED: "neutral", ARCHIVED: "neutral" },
  workflow: { DRAFT: "neutral", ACTIVE: "success", PAUSED: "warning", ARCHIVED: "neutral" },
  workflowRun: { QUEUED: "neutral", RUNNING: "accent", WAITING: "warning", SUCCEEDED: "success", FAILED: "danger", CANCELLED: "neutral" },
  workflowStep: { RUNNING: "accent", WAITING: "warning", SUCCEEDED: "success", FAILED: "danger", SKIPPED: "neutral" },
  brainDocument: { PROCESSING: "accent", READY: "success", FAILED: "danger" },
  approval: { PENDING: "warning", APPROVED: "success", REJECTED: "danger", EXPIRED: "neutral", EXECUTED: "success", FAILED: "danger", CANCELLED: "neutral" },
  aiBudget: { ok: "success", soft: "warning", over: "warning", blocked: "danger" },
};
