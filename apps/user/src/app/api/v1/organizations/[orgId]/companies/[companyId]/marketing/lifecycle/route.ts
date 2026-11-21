import { route } from "@/server/core/http";
import { departmentLifecycle } from "@/server/modules/marketing/lifecycle";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await departmentLifecycle(ctx, orgId, companyId) }));
