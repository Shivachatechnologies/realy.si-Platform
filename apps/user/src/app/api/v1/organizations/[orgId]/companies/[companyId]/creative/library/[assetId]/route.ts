import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveLibraryAsset, getLibraryAsset, updateAssetInput, updateLibraryAsset } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string; assetId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, assetId }) => getLibraryAsset(ctx, orgId, companyId, assetId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/creative/library/:assetId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, assetId }) => updateLibraryAsset(ctx, orgId, companyId, assetId, await body(req, updateAssetInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/creative/library/:assetId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, assetId }) => archiveLibraryAsset(ctx, orgId, companyId, assetId));
