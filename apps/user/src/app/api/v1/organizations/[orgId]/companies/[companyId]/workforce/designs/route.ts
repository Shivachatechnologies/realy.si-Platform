import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createDesign, designInput, listDesigns } from "@/server/modules/workforce/org-designer";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listDesigns(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/designs", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createDesign(ctx, orgId, companyId, await body(req, designInput)),
);
