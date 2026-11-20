import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listAssets, parseAssetFilters, uploadAsset, uploadInput } from "@/server/modules/marketing/assets";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listAssets(ctx, orgId, companyId, parseAssetFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/assets", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 15 * 1024 * 1024 }, async ({ req, ctx }, { orgId, companyId }) => uploadAsset(ctx, orgId, companyId, await body(req, uploadInput)));
