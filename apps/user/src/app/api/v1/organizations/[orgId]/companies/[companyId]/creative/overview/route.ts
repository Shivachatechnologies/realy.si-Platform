import { route } from "@/server/core/http";
import { studioOverview } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => studioOverview(ctx, orgId, companyId));
