import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { resumeDesign } from "@/server/modules/workforce/org-designer";

type P = { orgId: string; companyId: string; designId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/designs/:id/resume", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, designId }) => resumeDesign(ctx, orgId, companyId, designId),
);
