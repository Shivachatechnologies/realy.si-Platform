import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteAttendance } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string; id: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/attendance/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => deleteAttendance(ctx, orgId, companyId, id));
