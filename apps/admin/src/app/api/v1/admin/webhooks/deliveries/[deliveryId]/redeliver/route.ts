import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminRedeliver, webhookActionInput } from "@/server/modules/admin/webhooks-admin";

/** Redeliver one delivery now (platform.security.manage). */
export const POST = route<{ deliveryId: string }>({ auth: "required", name: "POST /admin/webhooks/deliveries/:deliveryId/redeliver", rateLimits: LIMITS.admin }, async ({ req, ctx }, { deliveryId }) => adminRedeliver(ctx, deliveryId, await body(req, webhookActionInput)));
