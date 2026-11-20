import { body, route } from "@/server/core/http";
import { decideProposal, decisionInput } from "@/server/modules/crm/proposals";

/** Customer's accept / decline on the public proposal page /p/<token> (no login; the token is the credential). */
export const POST = route<{ token: string }>(
  { auth: "none", name: "POST /public/proposals/:token/decision", rateLimits: [{ name: "proposal-decision:ip", limit: 20, windowMs: 15 * 60_000, sensitive: true, by: "ip" }] },
  async ({ req, ctx }, { token }) => decideProposal(token, await body(req, decisionInput), { ip: ctx.ip, userAgent: ctx.userAgent }),
);
