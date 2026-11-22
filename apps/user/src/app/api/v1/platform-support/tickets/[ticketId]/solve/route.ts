import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { solveMyPlatformTicket } from "@/server/modules/admin/support";

/** Mark my ticket as solved. */
export const POST = route<{ ticketId: string }>({ auth: "required", name: "POST /platform-support/tickets/:ticketId/solve", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { ticketId }) => solveMyPlatformTicket(ctx, ticketId));
