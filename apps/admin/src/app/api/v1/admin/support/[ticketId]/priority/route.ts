import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { priorityInput, setTicketPriority } from "@/server/modules/admin/support";

/** Change ticket priority (recomputes the SLA due time). */
export const PUT = route<{ ticketId: string }>({ auth: "required", name: "PUT /admin/support/:ticketId/priority", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => setTicketPriority(ctx, ticketId, await body(req, priorityInput)));
