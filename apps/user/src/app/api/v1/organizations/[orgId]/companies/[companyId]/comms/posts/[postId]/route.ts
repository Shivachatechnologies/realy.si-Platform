import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletePost, postInput, updatePost } from "@/server/modules/comms/feed";

type P = { orgId: string; companyId: string; postId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/posts/:postId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, postId }) => updatePost(ctx, orgId, companyId, postId, await body(req, postInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/posts/:postId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, postId }) => deletePost(ctx, orgId, companyId, postId),
);
