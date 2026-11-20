import { route } from "@/server/core/http";
import { commandCenter, parseRange } from "@/server/modules/marketing/analytics";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => commandCenter(ctx, orgId, companyId, parseRange(Object.fromEntries(req.nextUrl.searchParams))));
