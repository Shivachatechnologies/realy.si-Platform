import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { ticketAi, ticketAiInput } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => ticketAi(ctx, orgId, companyId, ticketId, await body(req, ticketAiInput)),
);
