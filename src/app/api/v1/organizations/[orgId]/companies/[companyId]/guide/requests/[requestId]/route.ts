import { route } from "@/server/core/http";
import { getGuideRequest } from "@/server/modules/guide/service";

type P = { orgId: string; companyId: string; requestId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, requestId }) => getGuideRequest(ctx, orgId, companyId, requestId));
