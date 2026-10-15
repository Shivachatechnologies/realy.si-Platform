import { route } from "@/server/core/http";
import { getGraph } from "@/server/modules/graph/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getGraph(ctx, orgId, companyId));
