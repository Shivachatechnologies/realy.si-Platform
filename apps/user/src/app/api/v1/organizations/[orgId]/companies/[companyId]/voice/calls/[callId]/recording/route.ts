import { route } from "@/server/core/http";
import { recordingResponse } from "@/server/modules/voice/calls";

type P = { orgId: string; companyId: string; callId: string };

/** The call's provider-hosted recording, streamed same-origin (supports Range for seeking). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, callId }) => recordingResponse(ctx, orgId, companyId, callId, req.headers.get("range")));
