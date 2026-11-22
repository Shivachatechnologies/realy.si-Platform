import "server-only";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { evaluateAutonomy, isCompanyAiPaused, type AutonomyDecision } from "@/server/modules/workforce/autonomy-policy";
import type { ActionClass } from "@/server/modules/workforce/autonomy-classes";
import type { AutopilotMode } from "@/generated/prisma/enums";
import type { Action } from "./definition";

/**
 * Governance of a workflow's external actions (docs/automation.md §Autonomy): actions that leave the company
 * (email, Slack, Teams, HTTP webhooks, Custom API) are checked before they run.
 *
 *  1. Company kill switch ("Pause all AI", AutonomySettings.paused): the run is held (it resumes by itself when the
 *     company is unpaused). It applies to every run, including ones a person started.
 *  2. The workflow's autonomy mode, for runs the workflow starts itself (events, schedules, incoming webhooks):
 *       OFF                → external actions are refused (the step fails);
 *       MANUAL / ASSISTED / APPROVAL_REQUIRED → a person approves each external action (Workflows → Approvals);
 *       AUTONOMOUS         → the company's autonomy policy decides (class, channel, daily limit, hours, money caps):
 *                            auto → runs and is recorded as an autonomous action; ask → approval; deny → refused.
 *     A run a person started (test run, "Run now") is that person's action: only OFF and the kill switch apply.
 */

export const EXTERNAL_ACTION_KINDS = ["send_email", "send_slack", "send_teams", "http_webhook", "custom_api"] as const;
export type ExternalKind = (typeof EXTERNAL_ACTION_KINDS)[number];
export const isExternalAction = (a: Pick<Action, "kind">): a is Extract<Action, { kind: ExternalKind }> => (EXTERNAL_ACTION_KINDS as readonly string[]).includes(a.kind);

/** Autonomy class and channel of an external action (for the company's autonomy policy). */
export function externalClass(kind: ExternalKind): { actionClass: ActionClass; channel: string } {
  if (kind === "send_email") return { actionClass: "send_message", channel: "email" };
  if (kind === "send_slack" || kind === "send_teams") return { actionClass: "send_message", channel: "chat" };
  return { actionClass: "send_message", channel: "web" };
}

/** Department the policy is looked up for (workflows are company operations). */
export const WORKFLOW_DEPARTMENT = "operations";
/** How long a held (paused) run waits before it checks again. */
export const PAUSE_RECHECK_MS = 5 * 60_000;

export type GateResult =
  | { kind: "run"; decision?: AutonomyDecision }
  | { kind: "hold"; reason: "company_paused" }
  | { kind: "approve"; reason: string }
  | { kind: "refuse"; reason: string };

export interface GateInput {
  organizationId: string;
  companyId: string;
  ctx: RequestContext;
  mode: AutopilotMode;
  /** The run was started by a person (test run or manual run). */
  personStarted: boolean;
  /** A person already approved this step (autonomy approval). */
  approved: boolean;
  action: Extract<Action, { kind: ExternalKind }>;
}

export async function gateExternalAction(g: GateInput): Promise<GateResult> {
  if (await isCompanyAiPaused(g.organizationId, g.companyId)) return { kind: "hold", reason: "company_paused" };
  if (g.mode === "OFF") return { kind: "refuse", reason: "External actions are turned off for this workflow (autonomy: Off)" };
  if (g.approved || g.personStarted) return { kind: "run" };
  if (g.mode !== "AUTONOMOUS") return { kind: "approve", reason: "This workflow's autonomy asks a person to approve external actions" };
  const cls = externalClass(g.action.kind);
  const d = await evaluateAutonomy(g.ctx, g.organizationId, g.companyId, { department: WORKFLOW_DEPARTMENT, ...cls });
  if (d.decision === "auto") return { kind: "run", decision: d };
  if (d.decision === "ask") return { kind: "approve", reason: d.message };
  if (d.reason === "company_paused") return { kind: "hold", reason: "company_paused" };
  return { kind: "refuse", reason: d.message };
}

/** Plain-language summary of an external action for the approver. */
export function describeExternal(a: Extract<Action, { kind: ExternalKind }>): string {
  switch (a.kind) {
    case "send_email":
      return `Send an email to ${a.to}: "${a.subject}"`;
    case "send_slack":
      return `Post to Slack #${a.channel.replace(/^#/, "")}`;
    case "send_teams":
      return "Post a Microsoft Teams channel message";
    case "http_webhook":
      return `Call the webhook ${safeHost(a.url)}`;
    case "custom_api":
      return `Call the Custom API: ${a.method} ${a.path}`;
  }
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "URL";
  }
};

/**
 * File (or reuse) the approval request of an external step. Approvers: anyone allowed to execute workflows in the
 * company (approverIds empty), notified in-app. Returns the request id.
 */
export async function requestExternalApproval(p: { organizationId: string; companyId: string; runId: string; stepId: string; workflowName: string; action: Extract<Action, { kind: ExternalKind }>; reason: string }): Promise<string> {
  return transaction(async (tx) => {
    const existing = await tx.workflowApprovalRequest.findUnique({ where: { runId_stepId: { runId: p.runId, stepId: p.stepId } }, select: { id: true, status: true } });
    if (existing?.status === "PENDING") return existing.id;
    const fields = {
      title: `${p.workflowName}: ${describeExternal(p.action)}`.slice(0, 300),
      message: p.reason.slice(0, 2000),
      approverIds: [] as string[],
      approverMode: "permission",
      approverPermission: "workflows.execute",
      timeoutHours: null,
      timeoutAction: null,
      expiresAt: null,
      escalateToIds: [] as string[],
      escalatedAt: null,
    };
    const req = existing
      ? await tx.workflowApprovalRequest.update({ where: { id: existing.id }, data: { ...fields, status: "PENDING", decidedById: null, decidedAt: null, note: null }, select: { id: true } })
      : await tx.workflowApprovalRequest.create({ data: { organizationId: p.organizationId, companyId: p.companyId, runId: p.runId, stepId: p.stepId, ...fields }, select: { id: true } });
    const recipients = await usersWithPermission(tx, p.organizationId, p.companyId, "workflows.execute");
    await notifyUsers(tx, p.organizationId, recipients, "automation.approval_requested", { title: fields.title, href: "/workflows/approvals", companyId: p.companyId });
    return req.id;
  });
}

/** The approval request of a run's step (autonomy approvals and request_approval steps share runId + stepId). */
export async function approvalStatus(runId: string, stepId: string) {
  return db().workflowApprovalRequest.findUnique({ where: { runId_stepId: { runId, stepId } }, select: { id: true, status: true, decidedById: true, note: true } });
}
