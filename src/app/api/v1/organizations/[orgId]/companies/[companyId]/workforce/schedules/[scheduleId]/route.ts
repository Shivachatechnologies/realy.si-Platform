import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSchedule, scheduleUpdateInput, updateSchedule } from "@/server/modules/workforce/schedules";

type P = { orgId: string; companyId: string; scheduleId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/workforce/schedules/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, scheduleId }) => updateSchedule(ctx, orgId, companyId, scheduleId, await body(req, scheduleUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/workforce/schedules/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, scheduleId }) => deleteSchedule(ctx, orgId, companyId, scheduleId),
);
