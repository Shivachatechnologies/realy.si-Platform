import { route } from "@/server/core/http";
import { getConversation } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; conversationId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, conversationId }) => getConversation(ctx, orgId, companyId, conversationId));
