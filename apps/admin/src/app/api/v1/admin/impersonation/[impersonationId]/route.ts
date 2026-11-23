import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { endImpersonation, endImpersonationInput } from "@/server/modules/admin/impersonation";

/** End an impersonation now (own sessions; anyone else's needs platform.security.manage and a reason). */
export const DELETE = route<{ impersonationId: string }>({ auth: "required", name: "DELETE /admin/impersonation/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { impersonationId }) =>
  endImpersonation(ctx, impersonationId, await body(req, endImpersonationInput)),
);
