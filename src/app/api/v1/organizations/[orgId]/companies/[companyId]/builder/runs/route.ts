import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createRun, createRunInput, listRuns } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listRuns(ctx, orgId, [companyId]) }));

/** POST { mode, brief } — starts the AI Company Builder for the company. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createRun(ctx, orgId, companyId, await body(req, createRunInput)),
);
