import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { breakGlass, breakGlassInput } from "@/server/modules/admin/roles";

/** Break-glass: time-boxed (≤ 4 h) SUPER_ADMIN for a security admin; MFA re-check, reason and typed phrase. */
export const POST = route({ auth: "required", name: "POST /admin/roles/break-glass", rateLimits: LIMITS.admin }, async ({ req, ctx }) => breakGlass(ctx, await body(req, breakGlassInput)));
