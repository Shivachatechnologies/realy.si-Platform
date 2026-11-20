import { route } from "@/server/core/http";
import { listOwners } from "@/server/modules/crm/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listOwners(ctx, orgId, companyId) }));
