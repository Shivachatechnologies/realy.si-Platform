import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateInitiative, updateInitiativeInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; initiativeId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/initiatives/:initiativeId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, initiativeId }) => updateInitiative(ctx, orgId, companyId, initiativeId, await body(req, updateInitiativeInput)));
