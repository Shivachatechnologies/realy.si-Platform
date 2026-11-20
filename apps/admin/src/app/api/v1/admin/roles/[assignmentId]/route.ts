import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeRoleAssignment, revokeRoleInput } from "@/server/modules/admin/roles";

/** Revoke a platform role assignment, with reason and MFA re-check (mfaCode). */
export const DELETE = route<{ assignmentId: string }>({ auth: "required", name: "DELETE /admin/roles/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { assignmentId }) =>
  revokeRoleAssignment(ctx, assignmentId, await body(req, revokeRoleInput)),
);
