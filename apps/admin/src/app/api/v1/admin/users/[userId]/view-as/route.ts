import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { viewAsInput, viewAsSummary } from "@/server/modules/admin/roles";

/** Read-only "view as" summary of one user (audited with the reason; no session impersonation). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/view-as", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  viewAsSummary(ctx, userId, await body(req, viewAsInput)),
);
