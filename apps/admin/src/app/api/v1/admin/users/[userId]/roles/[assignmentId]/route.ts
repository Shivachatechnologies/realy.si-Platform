import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeRoleInput, revokeUserRole } from "@/server/modules/admin/roles";

/** Revoke one of the user's platform roles, with reason and MFA re-check (mfaCode). */
export const DELETE = route<{ userId: string; assignmentId: string }>(
  { auth: "required", name: "DELETE /admin/users/:id/roles/:assignmentId", rateLimits: LIMITS.admin },
  async ({ req, ctx }, { userId, assignmentId }) => revokeUserRole(ctx, userId, assignmentId, await body(req, revokeRoleInput)),
);
