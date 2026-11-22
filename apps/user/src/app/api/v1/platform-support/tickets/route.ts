import { body, route, type RouteRateLimit } from "@/server/core/http";
import { createPlatformTicket, createTicketInput, listMyPlatformTickets } from "@/server/modules/admin/support";

/** New tickets per person: 10 per hour (abuse guard; replies have their own bucket). */
const CREATE: RouteRateLimit[] = [{ name: "platform-support-create:principal", limit: 10, windowMs: 60 * 60_000, by: "principal" }];

/** The signed-in person's tickets to Realy support (`?status=open|closed`, `?cursor=`). */
export const GET = route({ auth: "required", name: "GET /platform-support/tickets" }, async ({ req, ctx }) =>
  listMyPlatformTickets(ctx, { cursor: req.nextUrl.searchParams.get("cursor") ?? undefined, status: req.nextUrl.searchParams.get("status") ?? undefined }),
);

/** Open a ticket to Realy support. */
export const POST = route({ auth: "required", name: "POST /platform-support/tickets", rateLimits: CREATE, idempotent: true }, async ({ req, ctx }) => createPlatformTicket(ctx, await body(req, createTicketInput)));
