import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { acknowledgePolicy } from "@/server/modules/hr/policies";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/policies/:id/acknowledge", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, id }) => acknowledgePolicy(ctx, orgId, companyId, id));
