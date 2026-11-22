import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { askCopilot, copilotCapabilities, copilotInput } from "@/server/modules/admin/copilot";

/** What the read-only copilot can read for this admin. */
export const GET = route({ auth: "required", name: "GET /admin/copilot" }, async ({ ctx }) => copilotCapabilities(ctx));

/** Ask the read-only Admin Copilot (platform.copilot.use). */
export const POST = route({ auth: "required", name: "POST /admin/copilot", rateLimits: LIMITS.admin }, async ({ req, ctx }) => askCopilot(ctx, await body(req, copilotInput)));
