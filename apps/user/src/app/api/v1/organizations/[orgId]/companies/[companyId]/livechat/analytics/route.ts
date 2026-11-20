import { z } from "zod";
import { route } from "@/server/core/http";
import { livechatAnalytics } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string };
const days = z.coerce.number().int().min(1).max(365).catch(30);

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => livechatAnalytics(ctx, orgId, companyId, days.parse(req.nextUrl.searchParams.get("days") ?? 30)));
