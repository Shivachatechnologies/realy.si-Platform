import { route } from "@/server/core/http";
import { liveGraph } from "@/server/modules/workforce/live-network";

type P = { orgId: string; companyId: string };

/** The live company network: AI + human nodes with their reporting lines. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => liveGraph(ctx, orgId, companyId));
