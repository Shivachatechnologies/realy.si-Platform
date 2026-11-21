import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { capsInput, setAdCaps } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string; accountId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/accounts/:accountId/caps", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, accountId }) => setAdCaps(ctx, orgId, companyId, accountId, await body(req, capsInput)));
