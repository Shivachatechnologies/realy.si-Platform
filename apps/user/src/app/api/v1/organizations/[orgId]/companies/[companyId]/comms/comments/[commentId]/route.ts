import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteComment, editCommentInput, updateComment } from "@/server/modules/comms/feed";

type P = { orgId: string; companyId: string; commentId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/comments/:commentId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, commentId }) => updateComment(ctx, orgId, companyId, commentId, await body(req, editCommentInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/comments/:commentId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, commentId }) => deleteComment(ctx, orgId, companyId, commentId),
);
