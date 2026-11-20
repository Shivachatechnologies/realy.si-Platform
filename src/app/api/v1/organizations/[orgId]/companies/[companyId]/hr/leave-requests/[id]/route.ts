import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideLeave, leaveDecisionInput } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/leave-requests/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => decideLeave(ctx, orgId, companyId, id, await body(req, leaveDecisionInput)));
