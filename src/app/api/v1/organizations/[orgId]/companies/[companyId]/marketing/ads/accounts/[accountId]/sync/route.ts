import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { syncAdAccountNow } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string; accountId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/accounts/:accountId/sync", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, accountId }) => syncAdAccountNow(ctx, orgId, companyId, accountId));
