import { route } from "@/server/core/http";
import { listAgents } from "@/server/modules/support/common";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listAgents(ctx, orgId, companyId) }));
