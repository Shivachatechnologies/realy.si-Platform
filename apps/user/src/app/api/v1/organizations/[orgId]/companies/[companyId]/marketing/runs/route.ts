import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listRuns, runInput, startRun } from "@/server/modules/marketing/run";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listRuns(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/runs", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => startRun(ctx, orgId, companyId, await body(req, runInput)));
