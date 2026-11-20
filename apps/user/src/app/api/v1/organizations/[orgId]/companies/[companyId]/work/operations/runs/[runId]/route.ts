import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { runItemInput, setRunItem } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; runId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/operations/runs/:runId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, runId }) => setRunItem(ctx, orgId, companyId, runId, await body(req, runItemInput)));
