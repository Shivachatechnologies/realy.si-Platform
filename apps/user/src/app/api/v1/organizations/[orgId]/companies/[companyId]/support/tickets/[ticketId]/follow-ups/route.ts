import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createFollowUp, followUpInput } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/follow-ups", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => createFollowUp(ctx, orgId, companyId, ticketId, await body(req, followUpInput)),
);
