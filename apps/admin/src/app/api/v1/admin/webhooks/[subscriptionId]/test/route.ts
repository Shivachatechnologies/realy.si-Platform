import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { sendTestDelivery, webhookActionInput } from "@/server/modules/admin/webhooks-admin";

/** Send a signed webhook.test delivery now (platform.security.manage). */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/webhooks/:subscriptionId/test", rateLimits: LIMITS.admin }, async ({ req, ctx }, { subscriptionId }) => sendTestDelivery(ctx, subscriptionId, await body(req, webhookActionInput)));
