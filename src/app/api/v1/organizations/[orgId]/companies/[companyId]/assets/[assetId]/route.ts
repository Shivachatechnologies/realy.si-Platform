import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteAsset, getAsset, updateAsset, updateInput } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string; assetId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, assetId }) => getAsset(ctx, orgId, companyId, assetId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/assets/:assetId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, assetId }) => updateAsset(ctx, orgId, companyId, assetId, await body(req, updateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/assets/:assetId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, assetId }) => deleteAsset(ctx, orgId, companyId, assetId),
);
