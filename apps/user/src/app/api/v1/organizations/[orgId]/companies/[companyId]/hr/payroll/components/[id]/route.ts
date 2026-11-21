import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeComponent } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string; id: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/payroll/components/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => removeComponent(ctx, orgId, companyId, id));
