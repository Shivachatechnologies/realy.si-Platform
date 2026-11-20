import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateAsset, updateAssetInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; assetId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/operations/assets/:assetId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, assetId }) => updateAsset(ctx, orgId, companyId, assetId, await body(req, updateAssetInput)));
