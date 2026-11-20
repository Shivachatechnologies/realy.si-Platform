import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { discardDraft } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string; messageId: string };

export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/drafts/:messageId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, ticketId, messageId }) => discardDraft(ctx, orgId, companyId, ticketId, messageId),
);
