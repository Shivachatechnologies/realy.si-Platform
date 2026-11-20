import { z } from "zod";
import { body, route } from "@/server/core/http";
import { agentTyping, closeConversation, returnToAi, takeOver } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; conversationId: string };
const input = z.object({ action: z.enum(["take_over", "return_to_ai", "close", "typing"]) });

/** take_over | return_to_ai | close | typing (typing is sent every few seconds while a person types). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/livechat/conversations/:conversationId/actions", rateLimits: [{ name: "livechat-actions:principal", limit: 120, windowMs: 60_000, by: "principal" }], idempotent: true },
  async ({ req, ctx }, { orgId, companyId, conversationId }) => {
    const { action } = input.parse(await body(req, input));
    if (action === "take_over") return takeOver(ctx, orgId, companyId, conversationId);
    if (action === "return_to_ai") return returnToAi(ctx, orgId, companyId, conversationId);
    if (action === "close") return closeConversation(ctx, orgId, companyId, conversationId);
    return agentTyping(ctx, orgId, companyId, conversationId);
  },
);
