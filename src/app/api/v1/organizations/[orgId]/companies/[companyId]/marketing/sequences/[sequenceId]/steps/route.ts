import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addStep, stepInput } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string; sequenceId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId/steps", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sequenceId }) => addStep(ctx, orgId, companyId, sequenceId, await body(req, stepInput)));
