import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { ticketFeedbackInput, ticketToProductFeedback } from "@/server/modules/support/product-loop";

type P = { orgId: string; companyId: string; ticketId: string };

/** Share a ticket with the product team as product feedback (support → product loop). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/product-feedback", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => ticketToProductFeedback(ctx, orgId, companyId, ticketId, await body(req, ticketFeedbackInput)),
);
