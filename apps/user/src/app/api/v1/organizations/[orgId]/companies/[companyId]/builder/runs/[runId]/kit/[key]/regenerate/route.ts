import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { regenerateInput, regenerateItem } from "@/server/modules/builder/kit";

type P = { orgId: string; companyId: string; runId: string; key: string };

/** POST { feedback? } — generate the deliverable again (the logo right away, AI deliverables as an agent task). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit/:key/regenerate", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, runId, key }) => regenerateItem(ctx, orgId, companyId, runId, key, await body(req, regenerateInput)),
);
