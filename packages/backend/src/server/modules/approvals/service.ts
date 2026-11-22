import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, userContext, type RequestContext } from "@/server/core/context";
import { dispatchJob, MODULE_JOBS_QUEUE } from "@/server/core/jobs";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { loadGrants, mfaSatisfied, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { authorizeTool, runPrecheck, ToolDenied, verifyToolOutput, withTimeout } from "@/server/modules/tools/gateway";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { noteApprovalOutcome } from "@/server/modules/workforce/autonomy-policy";

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
    include: { task: { select: { id: true, title: true, status: true } } },
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
  // Actions an approval runs are retried with retryApproval, never re-decided.

  if (decision === "reject") {
    const out = await transaction(async (tx) => {
      const { count } = await tx.approval.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "REJECTED", ...decided } });
      if (!count) throw conflict("This request was decided by someone else", { reason: "approval_decided" });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.rejected", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, note } });
      await resolved(tx, ctx, a, "REJECTED");
      return { id: a.id, status: "REJECTED" as const };
    });
    // Trust system (docs/autonomy.md): rejections count against the AI department's record and may demote Auto mode.
    await noteApprovalOutcome(a, "rejection");
    return out;
  }

  await loadTools();
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

  // Executed right away as the approver (immediate feedback; the approver's MFA was just checked). The execution is
  // claimed per attempt, so a re-delivered request or a concurrent retry can never run it twice.
  const out = await executeApproval(ctx, a.id, { attempt: a.attempts + 1, note });
  if (out.status === "FAILED") throw new AppError("conflict", `Approved, but the action failed: ${out.error}`, { reason: "approval_failed", approvalId: a.id });
  return out;
}

export type ExecutionOutcome = { id: string; status: "EXECUTED"; result: string } | { id: string; status: "FAILED"; error: string } | { id: string; status: "SKIPPED" };

/**
 * Run an APPROVED action once (G1, B3). Idempotency key `approval:<id>:<attempt>`: the attempt is claimed with a
 * conditional update (APPROVED and attempts = attempt - 1), so only one execution per attempt ever happens, whether
 * it runs inline (decision / retry) or on the worker (module task `approvals.execute`). The outcome is stored,
 * audited and emitted as `approval.resolved`, which approvals/jobs.ts feeds back to the requesting task and run.
 */
export async function executeApproval(ctx: RequestContext, approvalId: string, opts: { attempt: number; note?: string | null }): Promise<ExecutionOutcome> {
  const claimed = await db().approval.updateMany({ where: { id: approvalId, status: "APPROVED", attempts: opts.attempt - 1 }, data: { attempts: opts.attempt, lastAttemptAt: new Date() } });
  if (!claimed.count) return { id: approvalId, status: "SKIPPED" };
  const a = await db().approval.findUniqueOrThrow({ where: { id: approvalId } });
  const { organizationId, companyId } = a;
  try {
    await loadTools();
    const tool = getTool(a.tool);
    if (!tool || tool.version !== a.toolVersion) throw new ToolDenied("failed", "This action is no longer available in this form");
    const input = tool.input.safeParse(a.input);
    if (!input.success) throw new ToolDenied("invalid_input", "The stored action input is no longer valid");
    // The executor must still hold every permission the action needs (re-checked on every attempt).
    await authorizeTool(tool, ctx, organizationId, companyId).catch((err) => {
      throw isAppError(err) && err.code === "mfa_required" ? err : new ToolDenied("not_permitted", "The approver lacks the permission this action needs");
    });
    // The proposal must still be valid now (e.g. its media still exists).
    await runPrecheck(tool, input.data, { ctx, organizationId, companyId });
    const out = verifyToolOutput(tool.name, await withTimeout(tool.execute(input.data, { ctx, organizationId, companyId }), tool.timeoutMs));
    await transaction(async (tx) => {
      await tx.approval.update({ where: { id: a.id }, data: { status: "EXECUTED", executedAt: new Date(), error: null, result: { content: out.content, records: out.records ?? [] } } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.executed", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, records: out.records ?? [], note: opts.note ?? undefined, attempt: opts.attempt } });
      await resolved(tx, ctx, a, "EXECUTED");
    });
    return { id: a.id, status: "EXECUTED", result: out.content };
  } catch (err) {
    const message = err instanceof ToolDenied ? err.message : isAppError(err) && err.code !== "internal_error" ? err.message : "The action failed";
    logger.warn({ approvalId: a.id, tool: a.tool, attempt: opts.attempt, err: err instanceof Error ? err.message : String(err) }, "approved action failed");
    await transaction(async (tx) => {
      await tx.approval.update({ where: { id: a.id }, data: { status: "FAILED", executedAt: new Date(), error: message.slice(0, 500) } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.failed", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, error: message, attempt: opts.attempt } });
      await resolved(tx, ctx, a, "FAILED");
    });
    await noteApprovalOutcome(a, "failure");
    return { id: a.id, status: "FAILED", error: message };
  }
}

/** Manual retries of one approved action (the first execution counts as attempt 1). */
export const MAX_APPROVAL_ATTEMPTS = 3;

/**
 * Retry a FAILED approved action (G1, B3). Same checks as approving (approvals.decide, every permission of the action,
 * MFA for HIGH/CRITICAL, organization owner for FOUNDER_ONLY); the retrier becomes the actor of record. Runs on the
 * worker queue when one is available (module task `approvals.execute`, job id `approval_<id>_<attempt>`), else inline.
 */
export async function retryApproval(ctx: RequestContext, organizationId: string, companyId: string, approvalId: string) {
  await authorize(ctx, organizationId, companyId, "approvals.decide");
  if (!isUuid(approvalId)) throw notFound("Approval");
  const a = await db().approval.findFirst({ where: { id: approvalId, organizationId, companyId } });
  if (!a) throw notFound("Approval");
  if (a.status !== "FAILED") throw conflict("Only failed actions can be retried", { reason: "approval_not_retryable" });
  if (a.attempts >= MAX_APPROVAL_ATTEMPTS) throw conflict("This action was retried too often; reject it or ask the AI for a new proposal", { reason: "approval_retry_limit" });
  await loadTools();
  const tool = getTool(a.tool);
  if (!tool || tool.version !== a.toolVersion) throw conflict("This action is no longer available in this form", { reason: "tool_changed" });
  try {
    await authorizeTool(tool, ctx, organizationId, companyId);
  } catch (err) {
    if (isAppError(err) && err.code === "mfa_required") throw err;
    throw new AppError("forbidden", "You lack the permission this action needs", { reason: "approver_lacks_permission", permissions: tool.permissions });
  }
  if ((a.risk === "HIGH" || a.risk === "CRITICAL" || a.autonomy === "FOUNDER_ONLY") && !mfaSatisfied(ctx)) {
    throw new AppError("mfa_required", "Retrying this action requires a recent two-factor verification");
  }
  if (a.autonomy === "FOUNDER_ONLY") {
    const grants = await loadGrants(db(), "USER", ctx.actor.id!);
    if (!grants.some((g) => g.roleKey === "ORGANIZATION_OWNER" && g.scopeType === "ORGANIZATION" && g.scopeId === organizationId)) {
      throw new AppError("forbidden", "Only an organization owner can retry this action", { reason: "founder_only" });
    }
  }
  const attempt = a.attempts + 1;
  await transaction(async (tx) => {
    const { count } = await tx.approval.updateMany({ where: { id: a.id, status: "FAILED", attempts: a.attempts }, data: { status: "APPROVED", decidedById: ctx.actor.id, error: null, lastAttemptAt: new Date() } });
    if (!count) throw conflict("This action changed meanwhile", { reason: "approval_decided" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "approval.retried", resourceType: "approval", resourceId: a.id, newValue: { tool: a.tool, attempt } });
  });
  const queued = await dispatchJob(MODULE_JOBS_QUEUE, "approvals.execute", { approvalId: a.id, attempt, actorId: ctx.actor.id }, { jobId: `approval_${a.id}_${attempt}`, organizationId });
  if (queued) return { id: a.id, status: "APPROVED" as const, queued: true };
  const out = await executeApproval(ctx, a.id, { attempt });
  return { ...out, queued: false };
}

/** Worker: run a queued approved action as the person who approved / retried it. */
export async function runQueuedApproval(data: Record<string, unknown>): Promise<number> {
  const approvalId = typeof data.approvalId === "string" ? data.approvalId : null;
  const attempt = typeof data.attempt === "number" ? data.attempt : null;
  const actorId = typeof data.actorId === "string" ? data.actorId : null;
  if (!approvalId || !attempt || !actorId || !isUuid(approvalId)) return 0;
  const out = await executeApproval(userContext(actorId, { requestId: `approval_${approvalId}_${attempt}`, mfaVerifiedAt: new Date() }), approvalId, { attempt });
  return out.status === "SKIPPED" ? 0 : 1;
}

/**
 * Worker maintenance: an approved action whose execution was lost (the request died mid-way) is marked FAILED after
 * 15 minutes, so it can be retried instead of looking busy forever.
 */
export async function failInterruptedApprovals(olderThanMs = 15 * 60_000): Promise<number> {
  const stale = await db().approval.findMany({ where: { status: "APPROVED", OR: [{ lastAttemptAt: { lt: new Date(Date.now() - olderThanMs) } }, { lastAttemptAt: null, decidedAt: { lt: new Date(Date.now() - olderThanMs) } }] }, take: 100, select: { id: true, organizationId: true, companyId: true, tool: true } });
  let n = 0;
  for (const a of stale) {
    const { count } = await db().approval.updateMany({ where: { id: a.id, status: "APPROVED" }, data: { status: "FAILED", error: "The execution was interrupted; retry it" } });
    if (!count) continue;
    n++;
    await transaction((tx) => resolved(tx, systemContext(), a, "FAILED")).catch(() => undefined);
  }
  return n;
}

/** Worker maintenance: pending requests past their deadline become EXPIRED. */
export async function expireApprovals(): Promise<number> {
  const { count } = await db().approval.updateMany({ where: { status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
  return count;
}
