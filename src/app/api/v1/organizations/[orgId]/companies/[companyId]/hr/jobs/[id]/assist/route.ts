import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistJob, jobAssistInput } from "@/server/modules/hr/assist";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/jobs/:id/assist", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => assistJob(ctx, orgId, companyId, id, await body(req, jobAssistInput)));
