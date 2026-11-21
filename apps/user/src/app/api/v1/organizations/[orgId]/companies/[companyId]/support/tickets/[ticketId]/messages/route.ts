import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addMessage, messageInput } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/messages", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => addMessage(ctx, orgId, companyId, ticketId, await body(req, messageInput)),
);
