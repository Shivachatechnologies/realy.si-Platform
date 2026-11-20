import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteRetroItem } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; itemId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/retro/:itemId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, itemId }) => deleteRetroItem(ctx, orgId, companyId, itemId));
