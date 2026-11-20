import { body, route } from "@/server/core/http";
import { publicRatingInput, ratePublicTicket } from "@/server/modules/support/tickets";

/** Customer satisfaction rating on the public ticket page /t/<token> (no login; the unguessable token is the credential). */
export const POST = route<{ token: string }>(
  { auth: "none", name: "POST /public/tickets/:token/rating", rateLimits: [{ name: "ticket-rating:ip", limit: 10, windowMs: 15 * 60_000, sensitive: true, by: "ip" }] },
  async ({ req }, { token }) => ratePublicTicket(token, await body(req, publicRatingInput)),
);
