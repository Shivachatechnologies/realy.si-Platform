import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getTicket, updateTicket, updateTicketInput } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, ticketId }) => getTicket(ctx, orgId, companyId, ticketId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/tickets/:ticketId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => updateTicket(ctx, orgId, companyId, ticketId, await body(req, updateTicketInput)),
);
