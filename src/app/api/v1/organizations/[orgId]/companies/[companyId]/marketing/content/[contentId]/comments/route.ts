import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { commentInput, commentOnContent } from "@/server/modules/marketing/content";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/comments", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => commentOnContent(ctx, orgId, companyId, contentId, await body(req, commentInput)));
