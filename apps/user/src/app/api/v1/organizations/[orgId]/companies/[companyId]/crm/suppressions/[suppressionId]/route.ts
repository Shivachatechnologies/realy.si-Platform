import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeSuppression } from "@/server/modules/crm/suppression";

type P = { orgId: string; companyId: string; suppressionId: string };

/** Remove an entry from the do-not-contact list. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/suppressions/:suppressionId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, suppressionId }) => removeSuppression(ctx, orgId, companyId, suppressionId),
);
