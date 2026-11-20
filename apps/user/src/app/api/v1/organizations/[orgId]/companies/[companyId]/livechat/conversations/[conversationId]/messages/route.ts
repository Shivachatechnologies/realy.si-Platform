import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { agentReply, replyInput } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; conversationId: string };

/** A team member replies in the live chat (takes the conversation over from the AI). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/livechat/conversations/:conversationId/messages", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, conversationId }) => agentReply(ctx, orgId, companyId, conversationId, await body(req, replyInput)),
);
