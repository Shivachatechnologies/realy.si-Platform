import { route } from "@/server/core/http";
import { adsOverview } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => adsOverview(ctx, orgId, companyId));
