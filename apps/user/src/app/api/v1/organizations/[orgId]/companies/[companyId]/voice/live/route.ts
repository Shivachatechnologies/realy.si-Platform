import { route } from "@/server/core/http";
import { liveBoard } from "@/server/modules/voice/live";

type P = { orgId: string; companyId: string };

/** Live call center board (polled every ~2 s by /voice/live). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => liveBoard(ctx, orgId, companyId));
