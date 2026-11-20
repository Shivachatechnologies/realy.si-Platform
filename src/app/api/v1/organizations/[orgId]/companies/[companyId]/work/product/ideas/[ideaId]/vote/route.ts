import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { toggleVote } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; ideaId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/ideas/:ideaId/vote", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, ideaId }) => toggleVote(ctx, orgId, companyId, ideaId));
