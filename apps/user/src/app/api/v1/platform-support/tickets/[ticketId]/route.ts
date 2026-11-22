import { route } from "@/server/core/http";
import { getMyPlatformTicket } from "@/server/modules/admin/support";

/** One of my tickets with the public conversation (internal notes are never included). */
export const GET = route<{ ticketId: string }>({ auth: "required", name: "GET /platform-support/tickets/:ticketId" }, async ({ ctx }, { ticketId }) => getMyPlatformTicket(ctx, ticketId));
