import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { restrictionsInput, setUserRestrictions } from "@/server/modules/admin/users";

/** Platform-set restrictions (read-only account, AI disabled), enforced in rbac. */
export const PUT = route<{ userId: string }>({ auth: "required", name: "PUT /admin/users/:id/restrictions", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  setUserRestrictions(ctx, userId, await body(req, restrictionsInput)),
);
