import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeSuppression } from "@/server/modules/marketing/deliverability";

type P = { orgId: string; companyId: string; suppressionId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/suppressions/:suppressionId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, suppressionId }) => removeSuppression(ctx, orgId, companyId, suppressionId));
