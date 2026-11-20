import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { runAction, runActionInput } from "@/server/modules/marketing/run";

type P = { orgId: string; companyId: string; runId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/runs/:runId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, runId }) => runAction(ctx, orgId, companyId, runId, await body(req, runActionInput)));
