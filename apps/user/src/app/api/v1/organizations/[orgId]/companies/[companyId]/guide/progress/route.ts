import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { progressInput, saveProgress } from "@/server/modules/guide/service";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/progress", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => saveProgress(ctx, orgId, companyId, await body(req, progressInput)),
);
