import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { engagementAction, engagementActionInput } from "@/server/modules/marketing/community";

type P = { orgId: string; companyId: string; engagementId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/community/:engagementId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, engagementId }) => engagementAction(ctx, orgId, companyId, engagementId, await body(req, engagementActionInput)));
