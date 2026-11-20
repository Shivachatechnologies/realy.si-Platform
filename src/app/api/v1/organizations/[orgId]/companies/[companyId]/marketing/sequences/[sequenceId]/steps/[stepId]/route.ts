import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteStep, stepInput, updateStep } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string; sequenceId: string; stepId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId/steps/:stepId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sequenceId, stepId }) => updateStep(ctx, orgId, companyId, sequenceId, stepId, await body(req, stepInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId/steps/:stepId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, sequenceId, stepId }) => deleteStep(ctx, orgId, companyId, sequenceId, stepId));
