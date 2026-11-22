import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setTicketStatus, statusInput } from "@/server/modules/admin/support";

/** Change ticket status (solve, close, reopen, hold). */
export const PUT = route<{ ticketId: string }>({ auth: "required", name: "PUT /admin/support/:ticketId/status", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => setTicketStatus(ctx, ticketId, await body(req, statusInput)));
