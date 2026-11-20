import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { FinanceExpenseClaimStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { cancelPendingRequestsTx, openApprovalRequestTx } from "./approval-rules";
import { authorize, companyInfo, dayString, fromMinor, isUuid, optionalText, optionalUuid, PAGE_SIZE, pageParam, param, positiveAmount, day, toDay, toMinor } from "./common";
import { decodeAttachment, findDocAttachment, upsertDocAttachment } from "./doc-attachments";
import { createTransactionTx, type attachmentInput } from "./transactions";

export const CLAIM_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const expenseClaimInput = z.object({
  date: day,
  amount: positiveAmount,
  description: z.string().trim().min(1).max(300),
  categoryId: optionalUuid,
  departmentId: optionalUuid,
  projectId: optionalUuid,
  merchant: optionalText(200),
  notes: optionalText(5000),
});

function requireUserId(ctx: RequestContext) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  return ctx.actor.id;
}

async function canManage(ctx: RequestContext, organizationId: string, companyId: string) {
  return can(ctx, "finance.manage", await companyChain(db(), organizationId, companyId));
}

async function checkClaimRefs(tx: Tx, organizationId: string, companyId: string, d: z.output<typeof expenseClaimInput>) {
  if (d.categoryId && !(await tx.financeCategory.findFirst({ where: { id: d.categoryId, organizationId, companyId, kind: "EXPENSE", archivedAt: null }, select: { id: true } }))) throw notFound("Category");
  if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Cost center");
  if (d.projectId && !(await tx.project.findFirst({ where: { id: d.projectId, organizationId, companyId }, select: { id: true } }))) throw notFound("Project");
}

/**
 * An employee submits an out-of-pocket expense (finance.read is enough). It always needs approval: the matching rule's
 * approvers decide, finance managers when no rule matches.
 */
export async function submitExpenseClaim(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof expenseClaimInput>, receipt?: z.input<typeof attachmentInput>) {
  const input = expenseClaimInput.parse(raw);
  const file = receipt ? decodeAttachment(receipt) : null;
  const requesterId = requireUserId(ctx);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.read", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await checkClaimRefs(tx, organizationId, companyId, input);
    const claim = await tx.financeExpenseClaim.create({
      data: {
        organizationId,
        companyId,
        requesterId,
        date: toDay(input.date),
        amountMinor: toMinor(input.amount, company.baseCurrency),
        currency: company.baseCurrency,
        description: input.description,
        categoryId: input.categoryId ?? null,
        departmentId: input.departmentId ?? null,
        projectId: input.projectId ?? null,
        merchant: input.merchant ?? null,
        notes: input.notes ?? null,
      },
    });
    if (file) await upsertDocAttachment(tx, organizationId, companyId, { expenseClaimId: claim.id }, file);
    await openApprovalRequestTx(
      tx,
      ctx,
      organizationId,
      companyId,
      { kind: "EXPENSE", expenseClaimId: claim.id, title: input.description, amountMinor: claim.amountMinor, currency: claim.currency, departmentIds: [claim.departmentId], categoryIds: [claim.categoryId], requestedById: requesterId },
      { required: true },
    );
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.expense_claim.submitted", resourceType: "finance_expense_claim", resourceId: claim.id, newValue: { amountMinor: claim.amountMinor, description: claim.description, receipt: !!file } });
    return claim;
  });
}

export interface ClaimFilters {
  status?: FinanceExpenseClaimStatus;
  q?: string;
  /** Everyone's claims (finance managers only). */
  all: boolean;
  page: number;
}

export function parseClaimFilters(raw: Record<string, string | string[] | undefined>): ClaimFilters {
  const status = param(raw, "status");
  return { status: (CLAIM_STATUSES as readonly string[]).includes(status ?? "") ? (status as FinanceExpenseClaimStatus) : undefined, q: param(raw, "q")?.slice(0, 200), all: param(raw, "all") === "1", page: pageParam(raw) };
}

export async function listExpenseClaims(ctx: RequestContext, organizationId: string, companyId: string, f: ClaimFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const all = f.all && (await canManage(ctx, organizationId, companyId));
  const where: Prisma.FinanceExpenseClaimWhereInput = {
    organizationId,
    companyId,
    ...(all ? {} : { requesterId: ctx.actor.id ?? "00000000-0000-0000-0000-000000000000" }),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ description: { contains: f.q, mode: "insensitive" } }, { merchant: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db().financeExpenseClaim.count({ where }),
    db().financeExpenseClaim.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { name: true } }, department: { select: { name: true } }, project: { select: { name: true } }, receipt: { select: { id: true } } },
    }),
  ]);
  const users = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requesterId))] } }, select: { id: true, name: true } });
  const nameBy = new Map(users.map((u) => [u.id, u.name]));
  return { all, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows: rows.map((r) => ({ ...r, requesterName: nameBy.get(r.requesterId) ?? null })) };
}

/** A claim is visible to its requester, its approvers and finance managers. */
async function visibleClaim(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const c = isUuid(id)
    ? await db().financeExpenseClaim.findFirst({
        where: { id, organizationId, companyId },
        include: { category: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, receipt: { select: { id: true, fileName: true, sizeBytes: true, contentType: true } }, approvals: { orderBy: { createdAt: "desc" } } },
      })
    : null;
  if (!c) throw notFound("Expense claim");
  const me = ctx.actor.id;
  const approver = !!me && c.approvals.some((a) => a.approverIds.includes(me));
  if (c.requesterId !== me && !approver && !(await canManage(ctx, organizationId, companyId))) throw notFound("Expense claim");
  return { claim: c, isRequester: c.requesterId === me, isApprover: approver };
}

export async function getExpenseClaim(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const { claim, isRequester, isApprover } = await visibleClaim(ctx, organizationId, companyId, id);
  const users = await db().user.findMany({ where: { id: { in: [claim.requesterId, ...(claim.decidedById ? [claim.decidedById] : [])] } }, select: { id: true, name: true } });
  const nameBy = new Map(users.map((u) => [u.id, u.name]));
  return { ...claim, requesterName: nameBy.get(claim.requesterId) ?? null, decidedByName: claim.decidedById ? (nameBy.get(claim.decidedById) ?? null) : null, isRequester, isApprover };
}

/** The requester withdraws a pending claim (deleted with its receipt; the approval request is cancelled). */
export async function withdrawExpenseClaim(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const me = requireUserId(ctx);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.read", tx);
    const c = isUuid(id) ? await tx.financeExpenseClaim.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!c) throw notFound("Expense claim");
    if (c.requesterId !== me) throw forbidden("Only the requester can withdraw a claim");
    if (c.status !== "PENDING") throw conflict("Only pending claims can be withdrawn", { reason: "finance_claim_not_pending" });
    await cancelPendingRequestsTx(tx, { expenseClaimId: id });
    await tx.financeApprovalRequest.deleteMany({ where: { expenseClaimId: id } });
    await tx.financeExpenseClaim.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.expense_claim.withdrawn", resourceType: "finance_expense_claim", resourceId: id, oldValue: { amountMinor: c.amountMinor, description: c.description } });
    return { ok: true };
  });
}

export async function putClaimReceipt(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof attachmentInput>) {
  const file = decodeAttachment(raw);
  const me = requireUserId(ctx);
  const manager = await canManage(ctx, organizationId, companyId);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.read", tx);
    const c = isUuid(id) ? await tx.financeExpenseClaim.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!c) throw notFound("Expense claim");
    if (c.requesterId !== me && !manager) throw forbidden("Only the requester can change the receipt");
    if (c.status !== "PENDING") throw conflict("The claim is already decided", { reason: "finance_claim_not_pending" });
    const a = await upsertDocAttachment(tx, organizationId, companyId, { expenseClaimId: id }, file);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.attachment.uploaded", resourceType: "finance_expense_claim", resourceId: id, newValue: { fileName: file.fileName, sizeBytes: file.data.length } });
    return a;
  });
}

export async function getClaimReceipt(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await visibleClaim(ctx, organizationId, companyId, id);
  return findDocAttachment(db(), organizationId, companyId, { expenseClaimId: id });
}

/** Approved: post the claim as an EXPENSE transaction paid from `financeAccountId` (copying the receipt). */
export async function approveClaimTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, id: string, opts: { financeAccountId?: string | null; note: string | null; deciderId: string }) {
  const c = await tx.financeExpenseClaim.findFirst({ where: { id, organizationId, companyId }, include: { receipt: true } });
  if (!c) throw notFound("Expense claim");
  if (c.status !== "PENDING") throw conflict("The claim is already decided", { reason: "finance_claim_not_pending" });
  const account = await tx.financeAccount.findFirst({
    where: { organizationId, companyId, archivedAt: null, ...(opts.financeAccountId ? { id: opts.financeAccountId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!account) throw conflict(opts.financeAccountId ? "Account not found" : "Add a bank, cash or card account to pay the claim from", { reason: "finance_claim_no_account" });
  const vendor = c.merchant ? await tx.account.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: c.merchant, mode: "insensitive" } }, select: { id: true } }) : null;
  const requester = await tx.user.findUnique({ where: { id: c.requesterId }, select: { name: true } });
  const t = await createTransactionTx(
    tx,
    ctx,
    organizationId,
    companyId,
    {
      type: "EXPENSE",
      date: dayString(c.date),
      amount: fromMinor(c.amountMinor, c.currency),
      financeAccountId: account.id,
      toAccountId: null,
      categoryId: c.categoryId,
      accountId: vendor?.id ?? null,
      departmentId: c.departmentId,
      projectId: c.projectId,
      description: c.description,
      reference: c.merchant,
      notes: [`Expense claim by ${requester?.name ?? "employee"}`, c.notes].filter(Boolean).join("\n").slice(0, 5000),
    },
    { currency: c.currency, source: "EXPENSE_CLAIM" },
  );
  if (c.receipt) {
    await tx.financeTxnAttachment.create({ data: { organizationId, companyId, transactionId: t.id, fileName: c.receipt.fileName, contentType: c.receipt.contentType, sizeBytes: c.receipt.sizeBytes, data: c.receipt.data } });
  }
  await tx.financeExpenseClaim.update({ where: { id }, data: { status: "APPROVED", financeAccountId: account.id, transactionId: t.id, decidedById: opts.deciderId, decidedAt: new Date(), decisionNote: opts.note } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.expense_claim.approved", resourceType: "finance_expense_claim", resourceId: id, newValue: { transactionId: t.id, amountMinor: c.amountMinor } });
  return t;
}

export async function rejectClaimTx(tx: Tx, ctx: RequestContext, organizationId: string, id: string, opts: { note: string | null; deciderId: string }) {
  await tx.financeExpenseClaim.update({ where: { id }, data: { status: "REJECTED", decidedById: opts.deciderId, decidedAt: new Date(), decisionNote: opts.note } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.expense_claim.rejected", resourceType: "finance_expense_claim", resourceId: id, newValue: { note: opts.note } });
}
