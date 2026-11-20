import { route } from "@/server/core/http";
import { searchLinkTargets } from "@/server/modules/brain/links";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await searchLinkTargets(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
}));
