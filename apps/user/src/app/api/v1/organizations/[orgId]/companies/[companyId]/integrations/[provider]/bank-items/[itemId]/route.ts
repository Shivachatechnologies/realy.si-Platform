import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { removePlaidItem } from "@/server/modules/integrations/services/banking";

type P = { orgId: string; companyId: string; provider: string; itemId: string };

/** Unlink one bank (Plaid /item/remove) and delete its staged accounts and transactions. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/integrations/:provider/bank-items/:itemId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, provider, itemId }) => {
    if (provider !== "plaid" || !/^[A-Za-z0-9_-]{8,100}$/.test(itemId)) throw notFound("Bank");
    return removePlaidItem(ctx, orgId, companyId, itemId);
  },
);
