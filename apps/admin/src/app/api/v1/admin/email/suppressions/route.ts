import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addSuppression, suppressionInput } from "@/server/modules/admin/email-admin";

/** Add an address to the platform suppression list. */
export const POST = route({ auth: "required", name: "POST /admin/email/suppressions", rateLimits: LIMITS.admin }, async ({ req, ctx }) => addSuppression(ctx, await body(req, suppressionInput)));
