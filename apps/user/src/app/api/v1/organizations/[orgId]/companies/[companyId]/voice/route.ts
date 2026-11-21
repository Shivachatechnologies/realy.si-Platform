import { route } from "@/server/core/http";
import { voiceOverview } from "@/server/modules/voice/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => voiceOverview(ctx, orgId, companyId));
