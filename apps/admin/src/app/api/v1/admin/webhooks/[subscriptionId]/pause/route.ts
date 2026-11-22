import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { pauseInput, setWebhookPaused } from "@/server/modules/admin/webhooks-admin";

/** Pause (park retries) or resume an endpoint (platform.security.manage). */
export const PUT = route<{ subscriptionId: string }>({ auth: "required", name: "PUT /admin/webhooks/:subscriptionId/pause", rateLimits: LIMITS.admin }, async ({ req, ctx }, { subscriptionId }) => setWebhookPaused(ctx, subscriptionId, await body(req, pauseInput)));
