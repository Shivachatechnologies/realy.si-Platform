import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveAsset, updateAsset, updateAssetInput } from "@/server/modules/marketing/assets";

type P = { orgId: string; companyId: string; assetId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/assets/:assetId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, assetId }) => updateAsset(ctx, orgId, companyId, assetId, await body(req, updateAssetInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/assets/:assetId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, assetId }) => archiveAsset(ctx, orgId, companyId, assetId));
