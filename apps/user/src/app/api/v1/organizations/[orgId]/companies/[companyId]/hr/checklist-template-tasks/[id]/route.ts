import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeTemplateTask } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/checklist-template-tasks/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => removeTemplateTask(ctx, orgId, companyId, id));
