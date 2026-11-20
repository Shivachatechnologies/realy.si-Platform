import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { askAnalyst, askInput } from "@/server/modules/marketing/intelligence";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/analyst", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => askAnalyst(ctx, orgId, companyId, await body(req, askInput)));
