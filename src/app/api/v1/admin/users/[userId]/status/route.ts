import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setUserStatus, userStatusInput } from "@/server/modules/admin/users";

export const PUT = route<{ userId: string }>(
  { auth: "required", name: "PUT /admin/users/:id/status", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { userId }) => setUserStatus(ctx, userId, await body(req, userStatusInput)),
);
