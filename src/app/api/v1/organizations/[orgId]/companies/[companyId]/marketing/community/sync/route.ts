import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { syncCommentsNow } from "@/server/modules/marketing/community";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/community/sync", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId }) => syncCommentsNow(ctx, orgId, companyId));
