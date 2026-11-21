import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assetInput, createAsset, listAssets } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listAssets(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/assets", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createAsset(ctx, orgId, companyId, await body(req, assetInput)));
