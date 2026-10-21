import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { loadGrants, mfaSatisfied, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { authorizeTool, ToolDenied, withTimeout } from "@/server/modules/tools/gateway";
import { getTool } from "@/server/modules/tools/registry";

export const decideInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });
export const listApprovalsInput = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "EXECUTED", "FAILED"]).optional() });

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "approvals.read" | "approvals.decide") {
  await requirePermission(ctx, permission, await companyChain(db(), organizationId, companyId));
}

export async function listApprovals(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof listApprovalsInput> = {}) {
  const { status } = listApprovalsInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "approvals.read");
  return db().approval.findMany({
    where: { organizationId, companyId, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    include: { task: { select: { id: true, title: true } } },
  });
}

async function resolved(tx: Prisma.TransactionClient, ctx: RequestContext, a: { id: string; organizationId: string; companyId: string; tool: string }, status: string) {
  await emitEvent(tx, ctx, "approval.resolved", { approvalId: a.id, companyId: a.companyId, tool: a.tool, status }, { organizationId: a.organizationId, companyId: a.companyId, aggregateType: "approval", aggregateId: a.id });
}

/**
 * A person decides an approval request. Adapted from the Shivacha OS approval flow, on Realy's RBAC:
 * - the decider needs `approvals.decide` AND every permission the action itself needs, at the same company;
 * - HIGH/CRITICAL actions need a fresh MFA session; FOUNDER_ONLY actions need an organization owner with MFA;
 * - the request is claimed atomically (PENDING → APPROVED/REJECTED) so it can never run twice, and expired requests
 *   are refused;
 * - the input is re-validated, and the action runs as the approver, who becomes the actor of record.
 */
export async function decideApproval(ctx: RequestContext, organizationId: string, companyId: string, approvalId: string, raw: z.input<typeof decideInput>) {
  const { decision, note } = decideInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "approvals.decide");
  if (!isUuid(approvalId)) throw notFound("Approval");
  const a = await db().approval.findFirst({ where: { id: approvalId, organizationId, companyId } });
  if (!a) throw notFound("Approval");
  if (a.status !== "PENDING") throw conflict(`This request is already ${a.status.toLowerCase()}`, { reason: "approval_decided" });
  if (a.expiresAt < new Date()) {
    await db().approval.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw conflict("This request has expired", { reason: "approval_expired" });
  }
  const decided = { decidedById: ctx.actor.id, decidedAt: new Date(), decisionNote: note || null };

  if (decision === "reject") {
    return transaction(async (tx) => {
      const { count } = await tx.approval.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "REJECTED", ...decided } });
      if (!count) throw conflict("This request was decided by someone else", { reason: "approval_decided" });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.rejected", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, note } });
      await resolved(tx, ctx, a, "REJECTED");
      return { id: a.id, status: "REJECTED" as const };
    });
  }

  const tool = getTool(a.tool);
  if (!tool || tool.version !== a.toolVersion) throw conflict("This action is no longer available in this form; reject it", { reason: "tool_changed" });
  const input = tool.input.safeParse(a.input);
  if (!input.success) throw conflict("The stored action input is no longer valid; reject it", { reason: "tool_changed" });
  // The approver must be able to perform the action themselves.
  try {
    await authorizeTool(tool, ctx, organizationId, companyId);
  } catch (err) {
    if (isAppError(err) && err.code === "mfa_required") throw err;
    throw new AppError("forbidden", "You lack the permission this action needs", { reason: "approver_lacks_permission", permissions: tool.permissions });
  }
  if ((a.risk === "HIGH" || a.risk === "CRITICAL" || a.autonomy === "FOUNDER_ONLY") && !mfaSatisfied(ctx)) {
    throw new AppError("mfa_required", "Approving this action requires a recent two-factor verification");
  }
  if (a.autonomy === "FOUNDER_ONLY") {
    const grants = await loadGrants(db(), "USER", ctx.actor.id!);
    if (!grants.some((g) => g.roleKey === "ORGANIZATION_OWNER" && g.scopeType === "ORGANIZATION" && g.scopeId === organizationId)) {
      throw new AppError("forbidden", "Only an organization owner can approve this action", { reason: "founder_only" });
    }
  }

  const { count } = await db().approval.updateMany({ where: { id: a.id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "APPROVED", ...decided } });
  if (!count) throw conflict("This request was decided by someone else or expired", { reason: "approval_decided" });

  try {
    const out = await withTimeout(tool.execute(input.data, { ctx, organizationId, companyId }), tool.timeoutMs);
    await transaction(async (tx) => {
      await tx.approval.update({ where: { id: a.id }, data: { status: "EXECUTED", executedAt: new Date(), result: { content: out.content, records: out.records ?? [] } } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.executed", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, records: out.records ?? [], note } });
      await resolved(tx, ctx, a, "EXECUTED");
    });
    return { id: a.id, status: "EXECUTED" as const, result: out.content };
  } catch (err) {
    const message =
      err instanceof ToolDenied ? err.message : isAppError(err) && err.code !== "internal_error" ? err.message : "The action failed";
    logger.warn({ approvalId: a.id, tool: a.tool, err: err instanceof Error ? err.message : String(err) }, "approved action failed");
    await transaction(async (tx) => {
      await tx.approval.update({ where: { id: a.id }, data: { status: "FAILED", executedAt: new Date(), error: message.slice(0, 500) } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.failed", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, error: message } });
      await resolved(tx, ctx, a, "FAILED");
    });
    throw new AppError("conflict", `Approved, but the action failed: ${message}`, { reason: "approval_failed" });
  }
}

/** Worker maintenance: pending requests past their deadline become EXPIRED. */
export async function expireApprovals(): Promise<number> {
  const { count } = await db().approval.updateMany({ where: { status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
  return count;
}
