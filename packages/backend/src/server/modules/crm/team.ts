import { z } from "zod";
import { transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, requireOwner, uuid } from "./common";

/** Per-owner sales capacity settings (team management page). Assignment rules skip unavailable or full owners. */

export const salesRepInput = z.object({
  maxOpenDeals: z.number().int().min(0).max(100_000).nullable().optional(),
  maxOpenLeads: z.number().int().min(0).max(100_000).nullable().optional(),
  available: z.boolean().optional(),
  role: z.string().trim().max(100).nullable().optional(),
});

export async function saveSalesRep(ctx: RequestContext, organizationId: string, companyId: string, ownerId: string, raw: z.input<typeof salesRepInput>) {
  const input = salesRepInput.parse(raw);
  const id = uuid.parse(ownerId);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireOwner(tx, organizationId, chain, id);
    const data = {
      ...(input.maxOpenDeals !== undefined ? { maxOpenDeals: input.maxOpenDeals } : {}),
      ...(input.maxOpenLeads !== undefined ? { maxOpenLeads: input.maxOpenLeads } : {}),
      ...(input.available !== undefined ? { available: input.available } : {}),
      ...(input.role !== undefined ? { role: input.role || null } : {}),
    };
    const rep = await tx.crmSalesRep.upsert({ where: { companyId_ownerId: { companyId, ownerId: id } }, create: { organizationId, companyId, ownerId: id, ...data }, update: data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.sales_rep.updated", resourceType: "user", resourceId: id, newValue: data });
    return rep;
  });
}
