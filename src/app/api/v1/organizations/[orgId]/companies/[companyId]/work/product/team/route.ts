import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { hireProductTeam, hireTeamInput } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/team", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => hireProductTeam(ctx, orgId, companyId, await body(req, hireTeamInput)));

