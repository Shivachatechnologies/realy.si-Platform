import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { escalateInput, escalateTicket } from "@/server/modules/admin/support";

/** Escalate a ticket (level + 1, priority bump). */
export const POST = route<{ ticketId: string }>({ auth: "required", name: "POST /admin/support/:ticketId/escalate", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ticketId }) => escalateTicket(ctx, ticketId, await body(req, escalateInput)));
