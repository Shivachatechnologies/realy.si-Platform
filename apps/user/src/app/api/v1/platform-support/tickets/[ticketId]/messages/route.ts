import { body, route, type RouteRateLimit } from "@/server/core/http";
import { customerReplyInput, replyMyPlatformTicket } from "@/server/modules/admin/support";

const REPLY: RouteRateLimit[] = [{ name: "platform-support-reply:principal", limit: 30, windowMs: 60 * 60_000, by: "principal" }];

/** Reply on my ticket (reopens a pending or solved ticket). */
export const POST = route<{ ticketId: string }>({ auth: "required", name: "POST /platform-support/tickets/:ticketId/messages", rateLimits: REPLY, idempotent: true }, async ({ req, ctx }, { ticketId }) =>
  replyMyPlatformTicket(ctx, ticketId, await body(req, customerReplyInput)),
);
