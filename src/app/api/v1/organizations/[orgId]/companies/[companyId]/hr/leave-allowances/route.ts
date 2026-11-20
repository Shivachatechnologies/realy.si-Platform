import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { allowanceInput, setAllowance } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/leave-allowances", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => setAllowance(ctx, orgId, companyId, await body(req, allowanceInput)));
