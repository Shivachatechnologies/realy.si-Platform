import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import type { RequestContext } from "@/server/core/context";
import { toolPolicy } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { notifyApprovers } from "@/server/modules/notifications/service";
import { NEVER_FOR_AGENTS } from "@/server/modules/rbac/catalog";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { classifyTool, toolChannel } from "@/server/modules/workforce/autonomy-classes";
import { evaluateAutonomy, finishAutonomousAction, reserveAutonomousAction, type AutonomyDecision } from "@/server/modules/workforce/autonomy-policy";
import { getTool, loadTools, type ToolDefinition, type ToolExecutionContext, type ToolOutput } from "./registry";

/** Approval requests expire after 72 h (docs/agent-runtime.md). */
export const APPROVAL_TTL_MS = 72 * 60 * 60_000;

/** A denial the agent can reason about; never a crash of the task. */
export class ToolDenied extends Error {
  constructor(
    readonly code: "unknown_tool" | "not_allowed" | "invalid_input" | "not_permitted" | "timeout" | "failed" | "suggest_only",
    message: string,
  ) {
    super(message);
  }
}

export interface ToolRun {
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  /** The agent profile's allow-list. */
  allowedTools: readonly string[];
  profileKey: string;
  taskId: string | null;
  cite?: ToolExecutionContext["cite"];
  /**
   * Set for AI task runs (agents/runtime.ts): the company's autonomy policy (docs/autonomy.md) then decides whether a
   * SUPERVISED tool runs on its own (Auto within limits), files an approval (Ask), or is refused (Off / Suggest /
   * paused). Calls without it — e.g. a person's "request approval" button — keep the plain approval flow.
   */
  autonomy?: { department: string; aiEmployeeId: string | null };
}

export type ToolCallResult =
  | (ToolOutput & { status: "executed"; /** Set when a SUPERVISED tool ran on its own under an autonomy policy. */ autonomousActionId?: string })
  | { status: "approval_requested"; approvalId: string; content: string };

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new ToolDenied("timeout", `The tool did not finish within ${ms / 1000}s`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Steps 4–5: the principal must hold every permission at the task's company, and none may be agent-forbidden. */
export async function authorizeTool(tool: ToolDefinition, ctx: RequestContext, organizationId: string, companyId: string) {
  if (tool.permissions.some((p) => NEVER_FOR_AGENTS.has(p))) throw new ToolDenied("not_allowed", `${tool.name} can never be used by an agent`);
  const chain = await companyChain(db(), organizationId, companyId);
  for (const p of tool.permissions) await requirePermission(ctx, p, chain);
}

/**
 * Tool gateway (docs/tool-system.md §2). Steps 1–6 never consult the model: lookup, agent allow-list, input schema,
 * the requester's permissions on the task's company, then the platform AI policy and — for AI task runs — the
 * company's autonomy policy (docs/autonomy.md). AUTONOMOUS tools execute now; SUPERVISED tools run on their own only
 * when the autonomy policy says Auto and its limits allow (audited, logged, counted); otherwise they — and every
 * FOUNDER_ONLY tool — only file an approval request and change nothing.
 */
export async function requestTool(name: string, rawInput: unknown, run: ToolRun): Promise<ToolCallResult> {
  await loadTools();
  const tool = getTool(name);
  if (!tool) throw new ToolDenied("unknown_tool", `Unknown tool ${name}`);
  if (!run.allowedTools.includes(name)) throw new ToolDenied("not_allowed", `Tool ${name} is not available to this role`);
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolDenied("invalid_input", `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`.slice(0, 300));
  try {
    await authorizeTool(tool, run.ctx, run.organizationId, run.companyId);
  } catch (err) {
    if (err instanceof ToolDenied) throw err;
    throw new ToolDenied("not_permitted", "Not permitted: the requesting user lacks the permission this action needs");
  }

  // Platform AI policy (Admin → AI & Workforce): a read-only ceiling refuses non-read tools; a supervised ceiling or
  // "require approval for all writes" turns every non-read tool into an approval request.
  const policy = await toolPolicy(tool);
  if (policy === "denied") throw new ToolDenied("not_allowed", `${tool.name} is disabled by the platform's AI policy (read-only)`);
  const x: ToolExecutionContext = { ctx: run.ctx, organizationId: run.organizationId, companyId: run.companyId, cite: run.cite };

  // Company autonomy policy (AI task runs only): Off / Suggest / paused refuse; Auto within limits runs without an approval.
  let autonomy: AutonomyDecision | null = null;
  const amount = run.autonomy ? (tool.amount?.(parsed.data) ?? null) : null;
  const req = run.autonomy
    ? { department: run.autonomy.department, actionClass: classifyTool(tool), amountMinor: amount?.amountMinor ?? null, currency: amount?.currency ?? null, channel: toolChannel(tool) }
    : null;
  const evalOpts = { platform: policy, founderOnly: tool.autonomy === "FOUNDER_ONLY" };
  if (req) {
    try {
      autonomy = await evaluateAutonomy(run.ctx, run.organizationId, run.companyId, req, evalOpts);
    } catch (err) {
      // Policy store unavailable (e.g. not migrated yet): fail safe to the behaviour before autonomy — never automatic.
      logger.warn({ err: err instanceof Error ? err.message : String(err), tool: tool.name }, "autonomy policy unavailable; using approvals");
      autonomy = null;
    }
  }
  if (run.autonomy && req && autonomy) {
    if (autonomy.decision === "deny") {
      if (autonomy.reason === "policy_suggest") {
        throw new ToolDenied("suggest_only", `Suggest only: ${autonomy.message}. Nothing was done or filed — describe the action you recommend in your deliverable for a person to take.`);
      }
      throw new ToolDenied("not_allowed", `Not done: ${autonomy.message}.`);
    }
    if (tool.autonomy !== "AUTONOMOUS" && autonomy.decision === "auto") {
      const summary = tool.summarize(parsed.data).slice(0, 1000);
      const reserved = await reserveAutonomousAction(run.ctx, run.organizationId, run.companyId, req, { summary, aiEmployeeId: run.autonomy.aiEmployeeId, taskId: run.taskId, tool: tool.name, input: parsed.data }, evalOpts);
      if (reserved.actionId) {
        let out: ToolOutput;
        try {
          out = await withTimeout(tool.execute(parsed.data, x), tool.timeoutMs);
        } catch (err) {
          const message = err instanceof ToolDenied ? err.message : err instanceof Error ? err.message : "The action failed";
          await finishAutonomousAction(run.ctx, run.organizationId, run.companyId, reserved.actionId, { ok: false, error: message }).catch(() => undefined);
          throw err;
        }
        let undo: { tool: string; input: unknown } | null = null;
        try {
          undo = tool.reverse?.(parsed.data, out) ?? null;
        } catch {
          undo = null;
        }
        await finishAutonomousAction(run.ctx, run.organizationId, run.companyId, reserved.actionId, { ok: true, result: out.content, records: out.records, undo });
        return { status: "executed", ...out, content: `Done automatically under the company's Auto mode policy (logged for review): ${out.content}`, autonomousActionId: reserved.actionId };
      }
      autonomy = reserved; // a limit was reached in the meantime: fall through to an approval request
    }
  }

  if (tool.autonomy === "AUTONOMOUS" && policy === "as_defined") {
    const out = await withTimeout(tool.execute(parsed.data, x), tool.timeoutMs);
    return { status: "executed", ...out };
  }

  const summary = tool.summarize(parsed.data).slice(0, 1000);
  const approval = await transaction(async (tx) => {
    const a = await tx.approval.create({
      data: {
        organizationId: run.organizationId,
        companyId: run.companyId,
        taskId: run.taskId,
        requestedByProfile: run.profileKey,
        requestedById: run.ctx.actor.id ?? run.organizationId,
        tool: tool.name,
        toolVersion: tool.version,
        input: parsed.data as Prisma.InputJsonValue,
        summary,
        risk: tool.risk,
        autonomy: tool.autonomy === "AUTONOMOUS" ? "SUPERVISED" : tool.autonomy,
        requiredPermissions: tool.permissions,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });
    await writeAudit(tx, run.ctx, { category: "TENANT", organizationId: run.organizationId, action: "approval.requested", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, summary, risk: a.risk, taskId: a.taskId, ...(autonomy ? { autonomyReason: autonomy.reason, policyId: autonomy.policyId } : {}) } });
    await notifyApprovers(tx, run.organizationId, { approvalId: a.id, companyId: run.companyId, summary });
    await emitEvent(tx, run.ctx, "approval.requested", { approvalId: a.id, companyId: run.companyId, tool: a.tool, risk: a.risk, taskId: a.taskId }, { organizationId: run.organizationId, companyId: run.companyId, aggregateType: "approval", aggregateId: a.id });
    return a;
  });
  return {
    status: "approval_requested",
    approvalId: approval.id,
    content: `Approval requested (not done yet): ${summary}.${autonomy && autonomy.reason !== "policy_ask" ? ` (${autonomy.message}.)` : ""} A person will approve or reject it in Realy. Do not assume it happened; mention it in your deliverable as a pending action.`,
  };
}

export const toolInputSchema = (tool: ToolDefinition) => tool.input as z.ZodType;
