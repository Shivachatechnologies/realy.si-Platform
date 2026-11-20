import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelChecklist, getChecklistApi } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getChecklistApi(ctx, orgId, companyId, id));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/checklists/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => cancelChecklist(ctx, orgId, companyId, id));
