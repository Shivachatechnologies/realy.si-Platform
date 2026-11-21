import { route } from "@/server/core/http";
import { listConversations } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listConversations(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
