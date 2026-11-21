import { route } from "@/server/core/http";
import { salesTeam } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** Sales team: members with capacity, workload and target attainment. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => salesTeam(ctx, orgId, companyId));
