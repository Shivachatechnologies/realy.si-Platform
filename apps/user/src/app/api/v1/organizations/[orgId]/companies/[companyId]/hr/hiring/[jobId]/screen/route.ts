import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { screenApplicants } from "@/server/modules/hr/hiring";

type P = { orgId: string; companyId: string; jobId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/hiring/:jobId/screen", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, jobId }) =>
  screenApplicants(ctx, orgId, companyId, jobId),
);
