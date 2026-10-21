import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { notifyApprovers } from "@/server/modules/notifications/service";
import { NEVER_FOR_AGENTS } from "@/server/modules/rbac/catalog";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, type ToolDefinition, type ToolExecutionContext, type ToolOutput } from "./registry";

/** Approval requests expire after 72 h (docs/agent-runtime.md). */
export const APPROVAL_TTL_MS = 72 * 60 * 60_000;

/** A denial the agent can reason about; never a crash of the task. */
export class ToolDenied extends Error {
  constructor(
    readonly code: "unknown_tool" | "not_allowed" | "invalid_input" | "not_permitted" | "timeout" | "failed",
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
}

export type ToolCallResult = (ToolOutput & { status: "executed" }) | { status: "approval_requested"; approvalId: string; content: string };

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
 * the requester's permissions on the task's company, then the autonomy policy. AUTONOMOUS tools execute now;
 * SUPERVISED / FOUNDER_ONLY tools only file an approval request and change nothing.
 */
export async function requestTool(name: string, rawInput: unknown, run: ToolRun): Promise<ToolCallResult> {
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

  if (tool.autonomy === "AUTONOMOUS") {
    const out = await withTimeout(tool.execute(parsed.data, { ctx: run.ctx, organizationId: run.organizationId, companyId: run.companyId, cite: run.cite }), tool.timeoutMs);
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
        autonomy: tool.autonomy,
        requiredPermissions: tool.permissions,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });
    await writeAudit(tx, run.ctx, { category: "TENANT", organizationId: run.organizationId, action: "approval.requested", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, summary, risk: a.risk, taskId: a.taskId } });
    await notifyApprovers(tx, run.organizationId, { approvalId: a.id, companyId: run.companyId, summary });
    await emitEvent(tx, run.ctx, "approval.requested", { approvalId: a.id, companyId: run.companyId, tool: a.tool, risk: a.risk, taskId: a.taskId }, { organizationId: run.organizationId, companyId: run.companyId, aggregateType: "approval", aggregateId: a.id });
    return a;
  });
  return {
    status: "approval_requested",
    approvalId: approval.id,
    content: `Approval requested (not done yet): ${summary}. A person will approve or reject it in Realy. Do not assume it happened; mention it in your deliverable as a pending action.`,
  };
}

export const toolInputSchema = (tool: ToolDefinition) => tool.input as z.ZodType;
