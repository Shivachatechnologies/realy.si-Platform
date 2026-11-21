import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getProcess, updateProcess, updateProcessInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; processId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, processId }) => getProcess(ctx, orgId, companyId, processId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/operations/processes/:processId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, processId }) => updateProcess(ctx, orgId, companyId, processId, await body(req, updateProcessInput)));
