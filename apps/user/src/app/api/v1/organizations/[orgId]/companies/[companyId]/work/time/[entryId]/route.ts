import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteTimeEntry } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; entryId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/time/:entryId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, entryId }) => deleteTimeEntry(ctx, orgId, companyId, entryId));
