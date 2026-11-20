import { body, route } from "@/server/core/http";
import { addPublicReply, publicReplyInput } from "@/server/modules/support/tickets";

/** Customer reply on the public ticket page /t/<token> (no login; the unguessable token is the credential). */
export const POST = route<{ token: string }>(
  { auth: "none", name: "POST /public/tickets/:token/replies", rateLimits: [{ name: "ticket-reply:ip", limit: 20, windowMs: 15 * 60_000, sensitive: true, by: "ip" }] },
  async ({ req }, { token }) => addPublicReply(token, await body(req, publicReplyInput)),
);
