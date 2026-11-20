import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { draftJobDescription } from "@/server/modules/hr/hiring";

type P = { orgId: string; companyId: string; jobId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/hiring/:jobId/describe", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, jobId }) =>
  draftJobDescription(ctx, orgId, companyId, jobId),
);
