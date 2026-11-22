import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { replyInput, replyTicket } from "@/server/modules/admin/support";

/** Public reply (emailed) or internal note. */
export const POST = route<{ ticketId: string }>({ auth: "required", name: "POST /admin/support/:ticketId/reply", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => replyTicket(ctx, ticketId, await body(req, replyInput)));
