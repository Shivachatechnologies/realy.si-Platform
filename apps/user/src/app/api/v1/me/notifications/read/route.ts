import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { markNotificationsRead, markReadInput } from "@/server/modules/notifications/service";

export const POST = route({ auth: "required", name: "POST /me/notifications/read", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }) =>
  markNotificationsRead(ctx, await body(req, markReadInput)),
);
