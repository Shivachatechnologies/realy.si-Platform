import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { composeEmail, composeInput, listThreads, parseThreadFilters } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listThreads(ctx, orgId, companyId, parseThreadFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/threads", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => composeEmail(ctx, orgId, companyId, await body(req, composeInput)),
);
