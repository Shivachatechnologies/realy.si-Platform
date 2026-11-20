import { route } from "@/server/core/http";
import { scopeOptions } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string };

/** GET — records artwork can be attached to (departments, campaigns, projects, AI employees, products). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await scopeOptions(ctx, orgId, companyId) }));
