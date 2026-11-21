import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createTeam, listTeams, teamInput } from "@/server/modules/hr/org";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listTeams(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/teams", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createTeam(ctx, orgId, companyId, await body(req, teamInput)));
