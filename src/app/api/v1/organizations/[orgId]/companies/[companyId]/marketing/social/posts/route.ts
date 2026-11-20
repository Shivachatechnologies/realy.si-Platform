import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPost, listPosts, parsePostFilters, postInput } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listPosts(ctx, orgId, companyId, parsePostFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/social/posts", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createPost(ctx, orgId, companyId, await body(req, postInput)));
