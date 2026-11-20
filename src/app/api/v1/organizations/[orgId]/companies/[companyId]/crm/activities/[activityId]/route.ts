import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteCrmActivity } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string; activityId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/activities/:activityId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, activityId }) =>
  deleteCrmActivity(ctx, orgId, companyId, activityId),
);
