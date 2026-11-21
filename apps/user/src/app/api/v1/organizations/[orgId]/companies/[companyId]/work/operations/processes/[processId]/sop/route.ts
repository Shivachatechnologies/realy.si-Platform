import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requestSopDraft, sopInput } from "@/server/modules/work/bottlenecks";

type P = { orgId: string; companyId: string; processId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/processes/:processId/sop", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, processId }) => requestSopDraft(ctx, orgId, companyId, processId, await body(req, sopInput)));
