import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { postAction, postActionInput } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string; postId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/social/posts/:postId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, postId }) => postAction(ctx, orgId, companyId, postId, await body(req, postActionInput)));
