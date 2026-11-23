import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { removeSuppression, removeSuppressionInput } from "@/server/modules/admin/email-admin";

/** Remove an address from the platform suppression list. */
export const DELETE = route<{ email: string }>({ auth: "required", name: "DELETE /admin/email/suppressions/:email", rateLimits: LIMITS.admin }, async ({ req, ctx }, { email }) => removeSuppression(ctx, email, await body(req, removeSuppressionInput)));
