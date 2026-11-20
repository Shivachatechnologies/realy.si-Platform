import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { distributeContent, distributeInput } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/distribute", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => distributeContent(ctx, orgId, companyId, contentId, await body(req, distributeInput)));
