import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { attachAsset, attachInput } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string; assetId: string };

/** POST { scopeType, scopeId } — use this asset as the chosen artwork of another scope. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/assets/:assetId/attach", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, assetId }) => attachAsset(ctx, orgId, companyId, assetId, await body(req, attachInput)),
);
