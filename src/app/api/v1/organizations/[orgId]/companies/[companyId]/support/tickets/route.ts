import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createTicket, createTicketInput, listTickets, parseTicketFilters } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listTickets(ctx, orgId, companyId, parseTicketFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createTicket(ctx, orgId, companyId, await body(req, createTicketInput)),
);
