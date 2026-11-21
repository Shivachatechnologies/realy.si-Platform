import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { brandCheckAsset } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string; assetId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/library/:assetId/brand-check", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, assetId }) => brandCheckAsset(ctx, orgId, companyId, assetId));
