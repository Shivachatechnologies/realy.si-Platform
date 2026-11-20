import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assetInput, createAsset, listAssets } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listAssets(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/assets", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createAsset(ctx, orgId, companyId, await body(req, assetInput)));
