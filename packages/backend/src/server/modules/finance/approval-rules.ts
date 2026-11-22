import { z } from "zod";
import type { FinanceApprovalKind } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { actorId, amount, authorize, companyInfo, isUuid, optionalUuid, toMinor } from "./common";

export const APPROVAL_KINDS = ["BILL", "EXPENSE"] as const;
export const APPROVER_MODES = ["FINANCE_MANAGERS", "DEPARTMENT_HEAD", "USER"] as const;

export const approvalRuleInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(APPROVAL_KINDS).nullable().optional().or(z.literal("").transform(() => null)),
  minAmount: amount.refine((v) => !v.startsWith("-"), "Must not be negative"),
  departmentId: optionalUuid,
  categoryId: optionalUuid,
  approverMode: z.enum(APPROVER_MODES).default("FINANCE_MANAGERS"),
  approverUserId: optionalUuid,
  active: z.boolean().default(true),
});
export const updateApprovalRuleInput = approvalRuleInput.partial();

export async function listApprovalRules(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().financeApprovalRule.findMany({ take: 500,
    where: { organizationId, companyId },
    orderBy: [{ active: "desc" }, { minAmountMinor: "asc" }, { name: "asc" }],
    include: { department: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
  });
}

async function checkRule(tx: Tx, organizationId: string, companyId: string, d: Partial<z.output<typeof approvalRuleInput>>) {
  if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Cost center");
  if (d.categoryId && !(await tx.financeCategory.findFirst({ where: { id: d.categoryId, organizationId, companyId, kind: "EXPENSE" }, select: { id: true } }))) throw notFound("Category");
  if (d.approverMode === "USER") {
    if (!d.approverUserId) throw invalid("Choose the approver", { reason: "finance_approver_required" });
    const member = await tx.membership.findFirst({ where: { organizationId, userId: d.approverUserId }, select: { id: true } });
    if (!member) throw notFound("Approver");
  }
}

export async function createApprovalRule(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof approvalRuleInput>) {
  const input = approvalRuleInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await checkRule(tx, organizationId, companyId, input);
    const r = await tx.financeApprovalRule.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        kind: input.kind ?? null,
        minAmountMinor: toMinor(input.minAmount, company.baseCurrency),
        departmentId: input.departmentId ?? null,
        categoryId: input.categoryId ?? null,
        approverMode: input.approverMode,
        approverUserId: input.approverMode === "USER" ? (input.approverUserId ?? null) : null,
        active: input.active,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.approval_rule.created", resourceType: "finance_approval_rule", resourceId: r.id, newValue: { name: r.name, kind: r.kind, minAmountMinor: r.minAmountMinor, approverMode: r.approverMode } });
    return r;
  });
}

export async function updateApprovalRule(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateApprovalRuleInput>) {
  const input = updateApprovalRuleInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeApprovalRule.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Approval rule");
    const mode = input.approverMode ?? before.approverMode;
    const approverUserId = input.approverUserId !== undefined ? input.approverUserId : before.approverUserId;
    await checkRule(tx, organizationId, companyId, { ...input, approverMode: mode, approverUserId });
    const r = await tx.financeApprovalRule.update({
      where: { id },
      data: {
        name: input.name,
        kind: input.kind === undefined ? undefined : input.kind,
        minAmountMinor: input.minAmount ? toMinor(input.minAmount, (await companyInfo(tx, organizationId, companyId)).baseCurrency) : undefined,
        departmentId: input.departmentId,
        categoryId: input.categoryId,
        approverMode: mode,
        approverUserId: mode === "USER" ? approverUserId : null,
        active: input.active,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.approval_rule.updated", resourceType: "finance_approval_rule", resourceId: id, oldValue: { name: before.name, minAmountMinor: before.minAmountMinor, active: before.active }, newValue: input });
    return r;
  });
}

export async function deleteApprovalRule(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeApprovalRule.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Approval rule");
    await tx.financeApprovalRequest.updateMany({ where: { ruleId: id }, data: { ruleId: null } });
    await tx.financeApprovalRule.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.approval_rule.deleted", resourceType: "finance_approval_rule", resourceId: id, oldValue: { name: before.name } });
    return { ok: true };
  });
}

/** The user account of a department's head employee (budget owner / department approver), if linked. */
export async function departmentHeadUser(client: Tx | ReturnType<typeof db>, companyId: string, departmentId: string | null | undefined) {
  if (!departmentId) return null;
  const d = await client.department.findFirst({ where: { id: departmentId, companyId }, select: { head: { select: { userId: true, status: true } } } });
  return d?.head?.userId ?? null;
}

interface ApprovalSubject {
  kind: FinanceApprovalKind;
  billId?: string;
  expenseClaimId?: string;
  title: string;
  amountMinor: bigint;
  currency: string;
  departmentIds: (string | null)[];
  categoryIds: (string | null)[];
  requestedById: string;
}

/** The most specific active rule matching the subject (scoped rules first, then the highest threshold). */
async function matchRule(tx: Tx, companyId: string, s: ApprovalSubject) {
  const deps = s.departmentIds.filter((x): x is string => !!x);
  const cats = s.categoryIds.filter((x): x is string => !!x);
  const rules = await tx.financeApprovalRule.findMany({
    where: {
      companyId,
      active: true,
      minAmountMinor: { lte: s.amountMinor },
      OR: [{ kind: null }, { kind: s.kind }],
      AND: [{ OR: [{ departmentId: null }, ...(deps.length ? [{ departmentId: { in: deps } }] : [])] }, { OR: [{ categoryId: null }, ...(cats.length ? [{ categoryId: { in: cats } }] : [])] }],
    },
  });
  const score = (r: (typeof rules)[number]) => (r.departmentId ? 2 : 0) + (r.categoryId ? 1 : 0);
  return rules.sort((a, b) => score(b) - score(a) || (b.minAmountMinor > a.minAmountMinor ? 1 : b.minAmountMinor < a.minAmountMinor ? -1 : 0))[0] ?? null;
}

async function resolveApprovers(tx: Tx, organizationId: string, companyId: string, rule: Awaited<ReturnType<typeof matchRule>>, s: ApprovalSubject) {
  let ids: string[] = [];
  if (rule?.approverMode === "USER" && rule.approverUserId) ids = [rule.approverUserId];
  else if (rule?.approverMode === "DEPARTMENT_HEAD") {
    const dep = rule.departmentId ?? s.departmentIds.find((x): x is string => !!x) ?? null;
    const head = await departmentHeadUser(tx, companyId, dep);
    if (head) ids = [head];
  }
  if (!ids.length) ids = await usersWithPermission(tx, organizationId, companyId, "finance.manage");
  // Segregation of duties: the requester doesn't approve their own request when someone else can.
  const others = ids.filter((u) => u !== s.requestedById);
  return others.length ? others : ids;
}

/**
 * Open an approval request for a bill or an expense claim when a rule matches (or always, with `required`). Notifies the
 * approvers. Returns null when no approval is needed.
 */
export async function openApprovalRequestTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, s: ApprovalSubject, opts: { required?: boolean } = {}) {
  const rule = await matchRule(tx, companyId, s);
  if (!rule && !opts.required) return null;
  const approverIds = await resolveApprovers(tx, organizationId, companyId, rule, s);
  if (!approverIds.length) throw invalid("Nobody can approve this yet: give someone finance.manage", { reason: "finance_no_approvers" });
  const req = await tx.financeApprovalRequest.create({
    data: {
      organizationId,
      companyId,
      kind: s.kind,
      billId: s.billId ?? null,
      expenseClaimId: s.expenseClaimId ?? null,
      ruleId: rule?.id ?? null,
      title: s.title.slice(0, 300),
      amountMinor: s.amountMinor,
      currency: s.currency,
      requestedById: s.requestedById,
      approverIds,
    },
  });
  await notifyUsers(tx, organizationId, approverIds, "finance.approval_requested", { companyId, title: s.title.slice(0, 200), href: `/finance/approvals?request=${req.id}` });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.approval.requested", resourceType: "finance_approval_request", resourceId: req.id, newValue: { kind: s.kind, billId: s.billId, expenseClaimId: s.expenseClaimId, amountMinor: s.amountMinor, ruleId: rule?.id ?? null, approvers: approverIds.length } });
  return req;
}

/** Cancel pending requests of a subject (bill voided / edited, claim withdrawn). */
export async function cancelPendingRequestsTx(tx: Tx, where: { billId?: string; expenseClaimId?: string }) {
  await tx.financeApprovalRequest.updateMany({ where: { ...where, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
}
