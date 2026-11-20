import { route } from "@/server/core/http";
import { performanceOf } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => performanceOf(ctx, orgId, companyId, id));
