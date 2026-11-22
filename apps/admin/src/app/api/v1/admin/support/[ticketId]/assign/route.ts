import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assignInput, assignTicket } from "@/server/modules/admin/support";

/** Assign, reassign or unassign a platform support ticket. */
export const PUT = route<{ ticketId: string }>({ auth: "required", name: "PUT /admin/support/:ticketId/assign", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => assignTicket(ctx, ticketId, await body(req, assignInput)));
