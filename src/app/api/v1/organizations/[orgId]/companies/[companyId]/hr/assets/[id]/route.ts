import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assetPatch, updateAsset } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/assets/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateAsset(ctx, orgId, companyId, id, await body(req, assetPatch)));
