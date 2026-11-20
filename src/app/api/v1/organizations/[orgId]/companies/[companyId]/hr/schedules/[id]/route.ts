import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { archiveSchedule } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string; id: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/schedules/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveSchedule(ctx, orgId, companyId, id));
