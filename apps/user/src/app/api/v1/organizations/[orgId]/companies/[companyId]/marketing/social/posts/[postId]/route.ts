import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletePost, getPost, updatePost, updatePostInput } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string; postId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, postId }) => getPost(ctx, orgId, companyId, postId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/social/posts/:postId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, postId }) => updatePost(ctx, orgId, companyId, postId, await body(req, updatePostInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/social/posts/:postId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, postId }) => deletePost(ctx, orgId, companyId, postId));
