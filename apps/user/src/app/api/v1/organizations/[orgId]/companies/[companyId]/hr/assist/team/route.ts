import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requestTeamOverview, teamOverviewInput } from "@/server/modules/hr/manager";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/assist/team", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => requestTeamOverview(ctx, orgId, companyId, await body(req, teamOverviewInput)));
