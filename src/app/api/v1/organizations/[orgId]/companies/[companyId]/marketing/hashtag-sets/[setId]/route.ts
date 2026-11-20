import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteHashtagSet } from "@/server/modules/marketing/intelligence";

type P = { orgId: string; companyId: string; setId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/hashtag-sets/:setId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, setId }) => deleteHashtagSet(ctx, orgId, companyId, setId));
