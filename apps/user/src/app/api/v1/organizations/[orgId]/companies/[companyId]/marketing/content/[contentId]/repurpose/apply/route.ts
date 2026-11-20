import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyRepurpose, applyRepurposeInput } from "@/server/modules/marketing/repurpose";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/repurpose/apply", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => applyRepurpose(ctx, orgId, companyId, contentId, await body(req, applyRepurposeInput)));
