import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { designInput, previewDesign } from "@/server/modules/workforce/org-designer";

type P = { orgId: string; companyId: string };

/** Compute a proposal without saving it (read-only). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/designs/preview", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => previewDesign(ctx, orgId, companyId, await body(req, designInput)),
);
