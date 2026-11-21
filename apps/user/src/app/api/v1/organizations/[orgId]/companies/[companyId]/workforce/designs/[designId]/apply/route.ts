import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyDesign, applyInput } from "@/server/modules/workforce/org-designer";

type P = { orgId: string; companyId: string; designId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/designs/:id/apply", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, designId }) => applyDesign(ctx, orgId, companyId, designId, await body(req, applyInput)),
);
