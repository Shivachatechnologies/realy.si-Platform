import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createFeedback } from "@/server/modules/work/product";
import { authorize, isUuid, uuid } from "./common";

/**
 * Support → Product loop: a ticket becomes product feedback (linked by supportTicketId) so the product team's
 * Feedback synthesis and Improvement plan deliverables see what customers report. Needs support.read on the ticket and
 * projects.manage for the feedback (checked by the product service).
 */

const SENTIMENT = { positive: "POSITIVE", neutral: "NEUTRAL", negative: "NEGATIVE" } as const;

export const ticketFeedbackInput = z.object({
  productId: uuid,
  featureId: uuid.optional().or(z.literal("").transform(() => undefined)),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional().or(z.literal("").transform(() => undefined)),
  /** What the product team should take from this ticket; defaults to the ticket's subject and description. */
  summary: z.string().trim().max(5000).optional(),
});

export async function ticketToProductFeedback(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, raw: z.input<typeof ticketFeedbackInput>) {
  const input = ticketFeedbackInput.parse(raw);
  if (!isUuid(ticketId)) throw notFound("Ticket");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.read", tx);
    const t = await tx.supportTicket.findFirst({
      where: { id: ticketId, organizationId, companyId },
      select: { id: true, number: true, subject: true, description: true, requesterId: true, accountId: true, classification: true, requester: { select: { accountId: true } } },
    });
    if (!t) throw notFound("Ticket");
    if (await tx.productFeedback.findFirst({ where: { companyId, supportTicketId: t.id, productId: input.productId, archivedAt: null }, select: { id: true } })) {
      throw conflict("This ticket is already feedback for that product", { reason: "support_feedback_exists" });
    }
    const cls = (t.classification ?? {}) as { sentiment?: keyof typeof SENTIMENT };
    const body = (input.summary || [`Support ticket #${t.number}: ${t.subject}`, t.description].filter(Boolean).join("\n\n")).slice(0, 10_000);
    const f = await createFeedback(
      ctx,
      organizationId,
      companyId,
      { source: "support", body, productId: input.productId, featureId: input.featureId, sentiment: input.sentiment ?? (cls.sentiment ? SENTIMENT[cls.sentiment] : undefined), accountId: (t.requester?.accountId && t.accountId && t.requester.accountId !== t.accountId ? t.requester.accountId : t.accountId) ?? undefined, contactId: t.requesterId ?? undefined },
      { supportTicketId: t.id, tx },
    );
    await tx.supportMessage.create({ data: { companyId, ticketId: t.id, kind: "INTERNAL_NOTE", authorType: "AGENT", authorUserId: ctx.actor.id, body: `Shared with the product team as feedback.` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.product_feedback", resourceType: "ticket", resourceId: t.id, newValue: { feedbackId: f.id, productId: input.productId } });
    return f;
  });
}

/** Product feedback taken from a ticket, plus pickers when the viewer may create feedback. */
export async function ticketProductLinks(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  const [canRead, canManage] = await Promise.all([can(ctx, "projects.read", chain), can(ctx, "projects.manage", chain)]);
  if (!canRead) return { canRead, canManage, feedback: [], products: [], features: [] };
  const [feedback, products, features] = await Promise.all([
    db().productFeedback.findMany({
      where: { organizationId, companyId, supportTicketId: ticketId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, sentiment: true, createdAt: true, product: { select: { id: true, name: true } }, feature: { select: { id: true, title: true } } },
    }),
    canManage ? db().product.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : [],
    canManage ? db().productFeature.findMany({ where: { organizationId, companyId, archivedAt: null, productId: { not: null }, status: { not: "CANCELLED" } }, orderBy: { title: "asc" }, take: 500, select: { id: true, title: true, productId: true } }) : [],
  ]);
  return { canRead, canManage, feedback, products, features };
}
