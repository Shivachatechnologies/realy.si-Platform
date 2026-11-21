import { route } from "@/server/core/http";
import { pollConversation } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; conversationId: string };

/** Live conversation view: new messages and state since ?after=<ISO time>. */
export const GET = route<P>(
  { auth: "required", rateLimits: [{ name: "livechat-poll:principal", limit: 120, windowMs: 60_000, by: "principal" }] },
  async ({ req, ctx }, { orgId, companyId, conversationId }) => pollConversation(ctx, orgId, companyId, conversationId, Object.fromEntries(req.nextUrl.searchParams)),
);
