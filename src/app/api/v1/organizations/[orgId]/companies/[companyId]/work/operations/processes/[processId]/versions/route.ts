import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addProcessVersion, processVersionInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; processId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/processes/:processId/versions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, processId }) => addProcessVersion(ctx, orgId, companyId, processId, await body(req, processVersionInput)));
