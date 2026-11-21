import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { journeyAction, journeyActionInput } from "@/server/modules/marketing/journey";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/journey/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => journeyAction(ctx, orgId, companyId, await body(req, journeyActionInput)));
