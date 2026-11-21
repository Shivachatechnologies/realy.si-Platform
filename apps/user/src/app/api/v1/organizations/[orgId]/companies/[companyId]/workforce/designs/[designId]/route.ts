import { route } from "@/server/core/http";
import { getDesign } from "@/server/modules/workforce/org-designer";

type P = { orgId: string; companyId: string; designId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, designId }) => getDesign(ctx, orgId, companyId, designId));
