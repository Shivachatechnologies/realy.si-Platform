import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { FinanceApprovalKind, FinanceApprovalStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { APPROVAL_KINDS } from "./approval-rules";
import { authorize, isUuid, optionalText, optionalUuid, PAGE_SIZE, pageParam, param } from "./common";
import { approveClaimTx, rejectClaimTx } from "./expense-claims";
import { approveBillTx, returnBillToDraftTx } from "./payables";

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export interface ApprovalFilters {
  /** "mine": requests I can decide; "requested": requests I made; "all": every request (finance managers). */
  scope: "mine" | "requested" | "all";
  status?: FinanceApprovalStatus;
  kind?: FinanceApprovalKind;
  page: number;
}

export function parseApprovalFilters(raw: Record<string, string | string[] | undefined>): ApprovalFilters {
  const scope = param(raw, "scope");
  const status = param(raw, "status");
  const kind = param(raw, "kind");
  return {
    scope: scope === "requested" || scope === "all" ? scope : "mine",
    status: (APPROVAL_STATUSES as readonly string[]).includes(status ?? "") ? (status as FinanceApprovalStatus) : status === "any" ? undefined : scope === "requested" || scope === "all" ? undefined : "PENDING",
    kind: (APPROVAL_KINDS as readonly string[]).includes(kind ?? "") ? (kind as FinanceApprovalKind) : undefined,
    page: pageParam(raw),
  };
}

export async function listApprovalRequests(ctx: RequestContext, organizationId: string, companyId: string, f: ApprovalFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const me = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  const manager = await can(ctx, "finance.manage", await companyChain(db(), organizationId, companyId));
  const scope = f.scope === "all" && !manager ? "mine" : f.scope;
  const where: Prisma.FinanceApprovalRequestWhereInput = {
    organizationId,
    companyId,
    ...(scope === "mine" ? { approverIds: { has: me } } : scope === "requested" ? { requestedById: me } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
  };
  const [total, rows, pendingForMe] = await Promise.all([
    db().financeApprovalRequest.count({ where }),
    db().financeApprovalRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        bill: { select: { id: true, number: true, status: true, dueDate: true, vendor: { select: { name: true } } } },
        expenseClaim: { select: { id: true, status: true, date: true, description: true, merchant: true, receipt: { select: { id: true } } } },
        rule: { select: { id: true, name: true } },
      },
    }),
    db().financeApprovalRequest.count({ where: { organizationId, companyId, status: "PENDING", approverIds: { has: me } } }),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, ...(r.decidedById ? [r.decidedById] : [])]))];
  const users = userIds.length ? await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameBy = new Map(users.map((u) => [u.id, u.name]));
  return {
    scope,
    manager,
    total,
    pendingForMe,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: rows.map((r) => ({ ...r, requestedByName: nameBy.get(r.requestedById) ?? null, decidedByName: r.decidedById ? (nameBy.get(r.decidedById) ?? null) : null, canDecide: r.status === "PENDING" && r.approverIds.includes(me) })),
  };
}

/** Pending requests the viewer can decide (badge counts, dashboards). */
export async function pendingApprovalCount(ctx: RequestContext, organizationId: string, companyId: string) {
  if (!ctx.actor.id) return 0;
  return db().financeApprovalRequest.count({ where: { organizationId, companyId, status: "PENDING", approverIds: { has: ctx.actor.id } } });
}

export const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: optionalText(2000),
  /** Expense claims: the account the reimbursement is paid from (default: the first active account). */
  financeAccountId: optionalUuid,
});

/**
 * Approve or reject a request. Only the request's approvers decide. Approving a bill posts it (Dr Expense / Cr AP);
 * approving an expense claim posts the EXPENSE transaction; rejecting returns a bill to draft and closes a claim.
 */
export async function decideApproval(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof decisionInput>) {
  const input = decisionInput.parse(raw);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  const me = ctx.actor.id;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.read", tx);
    const r = isUuid(id) ? await tx.financeApprovalRequest.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!r) throw notFound("Approval request");
    if (!r.approverIds.includes(me)) throw forbidden("You are not an approver of this request", { reason: "finance_not_approver" });
    // Claim the request first so two approvers can't both decide it.
    const { count } = await tx.financeApprovalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: me, decidedAt: new Date(), decisionNote: input.note ?? null },
    });
    if (!count) throw conflict("This request was already decided", { reason: "finance_approval_decided" });
    const note = input.note ?? null;
    let href = "/finance/approvals";
    if (r.kind === "BILL" && r.billId) {
      href = `/finance/bills/${r.billId}`;
      if (input.decision === "APPROVE") await approveBillTx(tx, ctx, organizationId, companyId, r.billId, me);
      else await returnBillToDraftTx(tx, ctx, organizationId, r.billId, note);
    } else if (r.kind === "EXPENSE" && r.expenseClaimId) {
      href = `/finance/claims/${r.expenseClaimId}`;
      if (input.decision === "APPROVE") await approveClaimTx(tx, ctx, organizationId, companyId, r.expenseClaimId, { financeAccountId: input.financeAccountId, note, deciderId: me });
      else await rejectClaimTx(tx, ctx, organizationId, r.expenseClaimId, { note, deciderId: me });
    }
    if (r.requestedById !== me) {
      await notifyUsers(tx, organizationId, [r.requestedById], input.decision === "APPROVE" ? "finance.approval_approved" : "finance.approval_rejected", { companyId, title: r.title.slice(0, 200), href });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.decision === "APPROVE" ? "finance.approval.approved" : "finance.approval.rejected", resourceType: "finance_approval_request", resourceId: id, newValue: { kind: r.kind, billId: r.billId, expenseClaimId: r.expenseClaimId, note } });
    return { ok: true, status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED" };
  });
}
