import { db, transaction } from "@/server/core/db";
import { createPaymentLink } from "@/server/modules/integrations/services/payments";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { balanceOf } from "./billing";
import { authorize, fromMinor, isUuid } from "./common";


/**
 * Create an online payment link for the invoice's balance through the connected payment provider and store it on the
 * invoice. Truthful: when no provider is connected or the provider refuses, nothing is stored and the reason is returned.
 */
export async function createInvoicePaymentLink(ctx: RequestContext, organizationId: string, companyId: string, invoiceId: string) {
  await authorize(ctx, organizationId, companyId, "finance.manage");
  const inv = isUuid(invoiceId) ? await db().invoice.findFirst({ where: { id: invoiceId, organizationId, companyId }, include: { account: { select: { name: true } } } }) : null;
  if (!inv) throw notFound("Invoice");
  if (inv.status === "VOID" || inv.status === "PAID") throw conflict("The invoice has nothing left to pay", { reason: "finance_invoice_not_open" });
  const balance = inv.status === "DRAFT" ? inv.totalMinor : balanceOf(inv);
  if (balance <= 0n) throw conflict("The invoice has nothing left to pay", { reason: "finance_invoice_not_open" });
  const r = await createPaymentLink(organizationId, companyId, {
    // Integrations takes a plain number of minor units (safe: invoice balances are far below 2^53).
    amountMinor: Number(balance),
    currency: inv.currency,
    description: `Invoice ${inv.number} — ${inv.account.name} (${fromMinor(balance, inv.currency)} ${inv.currency})`.slice(0, 250),
    reference: inv.number,
  });
  if (!r.ok) {
    await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.payment_link_failed", resourceType: "invoice", resourceId: inv.id, newValue: { error: r.error.slice(0, 300) } }));
    return { ok: false as const, error: r.error, url: null };
  }
  await transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { paymentLinkUrl: r.data.url, paymentLinkId: r.data.id, paymentLinkProvider: r.providerId, paymentLinkAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.payment_link_created", resourceType: "invoice", resourceId: inv.id, newValue: { provider: r.providerId, linkId: r.data.id } });
  });
  return { ok: true as const, url: r.data.url, provider: r.providerId };
}
