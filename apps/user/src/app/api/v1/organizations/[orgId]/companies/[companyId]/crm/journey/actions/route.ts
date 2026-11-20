import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { journeyAction, journeyActionInput } from "@/server/modules/crm/guided";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/journey/actions", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => journeyAction(ctx, orgId, companyId, await body(req, journeyActionInput), { locale: req.nextUrl.searchParams.get("locale") }),
);
