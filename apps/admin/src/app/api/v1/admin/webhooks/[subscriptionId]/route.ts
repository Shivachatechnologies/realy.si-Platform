import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setWebhookActive, webhookStateInput } from "@/server/modules/admin/developers";

/** Disable / re-enable any tenant's outbound webhook (platform.security.manage). */
export const PUT = route<{ subscriptionId: string }>({ auth: "required", name: "PUT /admin/webhooks/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { subscriptionId }) =>
  setWebhookActive(ctx, subscriptionId, await body(req, webhookStateInput)),
);
