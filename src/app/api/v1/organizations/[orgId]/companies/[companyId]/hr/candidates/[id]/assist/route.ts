import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistCandidate, candidateAssistInput } from "@/server/modules/hr/assist";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/candidates/:id/assist", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => assistCandidate(ctx, orgId, companyId, id, await body(req, candidateAssistInput)));
