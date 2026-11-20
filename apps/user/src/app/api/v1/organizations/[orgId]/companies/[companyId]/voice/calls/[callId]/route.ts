import { route } from "@/server/core/http";
import { getCall } from "@/server/modules/voice/calls";

type P = { orgId: string; companyId: string; callId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, callId }) => getCall(ctx, orgId, companyId, callId));
