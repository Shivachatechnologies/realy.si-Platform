import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateIdea, updateIdeaInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; ideaId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/ideas/:ideaId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, ideaId }) => updateIdea(ctx, orgId, companyId, ideaId, await body(req, updateIdeaInput)));
