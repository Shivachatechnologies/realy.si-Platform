import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteRelease, updateRelease, updateReleaseInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; releaseId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/releases/:releaseId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, releaseId }) => updateRelease(ctx, orgId, companyId, releaseId, await body(req, updateReleaseInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/product/releases/:releaseId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, releaseId }) => deleteRelease(ctx, orgId, companyId, releaseId));
