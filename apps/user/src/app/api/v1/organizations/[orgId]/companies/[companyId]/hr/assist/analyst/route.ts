import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { analystInput, askPeopleAnalyst } from "@/server/modules/hr/assist";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/assist/analyst", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => askPeopleAnalyst(ctx, orgId, companyId, await body(req, analystInput)));
