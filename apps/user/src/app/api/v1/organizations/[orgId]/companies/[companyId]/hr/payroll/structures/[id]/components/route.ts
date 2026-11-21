import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addComponent, componentInput } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/payroll/structures/:id/components", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => addComponent(ctx, orgId, companyId, id, await body(req, componentInput)));
