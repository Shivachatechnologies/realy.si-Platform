import { z } from "zod";
import { transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { accountInput, insertAccount } from "./accounts";
import { authorize, blank, isUuid, moneyInput, requireOwner, toMajor, uuid } from "./common";
import { contactInput, insertContact } from "./contacts";
import { dealInput, insertDeal } from "./deals";

export const convertLeadInput = z.object({
  /** Link to an existing account instead of creating one. */
  accountId: uuid.optional().or(blank),
  /** Name of the new account (defaults to the lead's company, else the lead's name). */
  accountName: z.string().trim().max(200).optional(),
  accountType: z.enum(["PROSPECT", "CUSTOMER", "PARTNER"]).default("CUSTOMER"),
  createDeal: z.boolean().default(true),
  dealName: z.string().trim().max(200).optional(),
  amount: moneyInput.optional().or(blank),
  pipelineId: uuid.optional().or(blank),
  stageId: uuid.optional().or(blank),
  ownerId: uuid.optional().or(blank),
});

/**
 * Convert a lead into a contact, an account (new or existing) and optionally a deal. The lead's timeline is copied to
 * the new contact, the lead is marked converted (kept for history). Emits contact.created, customer.created (new
 * customer accounts), deal.created and lead.updated.
 */
export async function convertLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof convertLeadInput>) {
  const input = convertLeadInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const lead = isUuid(leadId) ? await tx.lead.findFirst({ where: { id: leadId, organizationId, companyId, archivedAt: null }, include: { activities: true } }) : null;
    if (!lead) throw notFound("Lead");
    if (lead.convertedAt) throw conflict("This lead was already converted", { reason: "crm_lead_converted" });
    const ownerId = input.ownerId || lead.ownerId || undefined;
    if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);

    let accountId = input.accountId || null;
    let accountCreated = false;
    if (accountId) {
      if (!(await tx.account.findFirst({ where: { id: accountId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Account");
    } else {
      const name = (input.accountName || lead.account || lead.name).trim();
      const existing = await tx.account.findFirst({ where: { companyId, archivedAt: null, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (existing) accountId = existing.id;
      else {
        const domain = lead.emailNormalized?.split("@")[1];
        const a = await insertAccount(
          tx,
          ctx,
          organizationId,
          companyId,
          accountInput.parse({ name, type: input.accountType, source: lead.source ?? undefined, territory: lead.territory ?? undefined, ownerId, domain, tags: lead.tags, allowDuplicate: true }),
        );
        accountId = a.id;
        accountCreated = true;
      }
    }

    const [firstName, ...rest] = lead.name.trim().split(/\s+/);
    const contact = await insertContact(
      tx,
      ctx,
      organizationId,
      companyId,
      contactInput.parse({ firstName: firstName || lead.name, lastName: rest.join(" ") || undefined, email: lead.email ?? undefined, phone: lead.phone ?? undefined, accountId, ownerId, tags: lead.tags, allowDuplicate: true }),
      { leadId: lead.id },
    );
    if (lead.activities.length) {
      await tx.crmActivity.createMany({
        data: lead.activities.map((a) => ({
          organizationId,
          companyId,
          type: a.type,
          summary: a.summary,
          occurredAt: a.occurredAt,
          contactId: contact.id,
          accountId,
          createdById: a.createdById,
        })),
      });
    }

    let dealId: string | null = null;
    if (input.createDeal) {
      const deal = await insertDeal(
        tx,
        ctx,
        organizationId,
        companyId,
        dealInput.parse({
          name: input.dealName || `${lead.account || lead.name}`,
          accountId,
          contactId: contact.id,
          ownerId,
          pipelineId: input.pipelineId,
          stageId: input.stageId,
          amount: input.amount ?? (lead.valueMinor != null ? toMajor(lead.valueMinor, lead.currency) : undefined),
          currency: lead.currency,
          probability: lead.probability ?? undefined,
          expectedCloseDate: lead.expectedCloseDate ? lead.expectedCloseDate.toISOString().slice(0, 10) : undefined,
          source: lead.source ?? undefined,
          campaignCode: lead.campaignCode ?? undefined,
          description: lead.notes ?? undefined,
          tags: lead.tags,
        }),
        { leadId: lead.id },
      );
      dealId = deal.id;
    }

    await tx.lead.update({ where: { id: lead.id }, data: { convertedAt: new Date(), convertedDealId: dealId, qualified: true, qualifiedAt: lead.qualifiedAt ?? new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.converted", resourceType: "lead", resourceId: lead.id, newValue: { contactId: contact.id, accountId, accountCreated, dealId } });
    await emitDomainEvent(tx, ctx, "lead.updated", {
      organizationId,
      companyId,
      entityType: "lead",
      entityId: lead.id,
      data: { name: lead.name, converted: true, contactId: contact.id, accountId, dealId, stage: lead.stage, ownerId: lead.ownerId },
    });
    return { leadId: lead.id, contactId: contact.id, accountId, dealId };
  });
}
