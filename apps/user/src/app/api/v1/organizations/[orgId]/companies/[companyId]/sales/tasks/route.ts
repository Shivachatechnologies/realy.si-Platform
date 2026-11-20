import { route } from "@/server/core/http";
import { mySalesTasks } from "@/server/modules/crm/tasks";

type P = { orgId: string; companyId: string };

/** The signed-in user's sales tasks (WorkTasks linked to deals, leads and accounts). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => mySalesTasks(ctx, orgId, companyId));
