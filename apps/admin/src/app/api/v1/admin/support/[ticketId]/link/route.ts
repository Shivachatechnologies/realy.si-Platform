import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { linkInput, linkTicket } from "@/server/modules/admin/support";

/** Link a ticket to an incident / organization and set tags. */
export const PUT = route<{ ticketId: string }>({ auth: "required", name: "PUT /admin/support/:ticketId/link", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => linkTicket(ctx, ticketId, await body(req, linkInput)));
