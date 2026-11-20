import { route } from "@/server/core/http";
import { listTemplates } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listTemplates(ctx, orgId, companyId) }));
