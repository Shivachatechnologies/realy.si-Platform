import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { stepAction, stepActionInput } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string; projectId: string; step: string };
/** POST { action: run | rerun | skip | edit } on one pipeline step. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/projects/:projectId/steps/:step", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId, step }) => stepAction(ctx, orgId, companyId, projectId, step, await body(req, stepActionInput)));
