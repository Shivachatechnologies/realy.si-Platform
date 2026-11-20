import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reactionInput, toggleReaction } from "@/server/modules/comms/feed";

type P = { orgId: string; companyId: string; postId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/posts/:postId/reactions", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, postId }) => toggleReaction(ctx, orgId, companyId, postId, await body(req, reactionInput)),
);
