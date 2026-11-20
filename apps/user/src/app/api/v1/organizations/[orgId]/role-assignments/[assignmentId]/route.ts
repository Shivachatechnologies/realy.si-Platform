import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { revokeAssignment } from "@/server/modules/rbac/service";

export const DELETE = route<{ orgId: string; assignmentId: string }>({ auth: "required", name: "DELETE /organizations/:orgId/role-assignments/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, assignmentId }) => {
  await revokeAssignment(ctx, orgId, assignmentId);
  return { ok: true };
});
