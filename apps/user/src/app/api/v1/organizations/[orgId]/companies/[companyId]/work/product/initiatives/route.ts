import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createInitiative, initiativeInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/initiatives", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createInitiative(ctx, orgId, companyId, await body(req, initiativeInput)));
