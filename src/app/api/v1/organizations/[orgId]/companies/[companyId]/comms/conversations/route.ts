import { route } from "@/server/core/http";
import { listConversations } from "@/server/modules/comms/hub";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  listConversations(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q")?.slice(0, 200) || undefined, unread: req.nextUrl.searchParams.get("unread") === "1" }),
);
