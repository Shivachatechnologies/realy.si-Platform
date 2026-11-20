import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { changeTeamMember, teamMemberInput } from "@/server/modules/hr/org";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/teams/:id/members", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => changeTeamMember(ctx, orgId, companyId, id, await body(req, teamMemberInput)));
