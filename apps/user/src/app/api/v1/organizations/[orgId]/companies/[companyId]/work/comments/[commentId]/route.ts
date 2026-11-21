import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteComment } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; commentId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/comments/:commentId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, commentId }) => deleteComment(ctx, orgId, companyId, commentId));
