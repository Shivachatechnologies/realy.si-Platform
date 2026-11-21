import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveScenes, saveScenesInput } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string; projectId: string };
export const PUT = route<P>({ auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/creative/projects/:projectId/scenes", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, projectId }) => saveScenes(ctx, orgId, companyId, projectId, await body(req, saveScenesInput)));
