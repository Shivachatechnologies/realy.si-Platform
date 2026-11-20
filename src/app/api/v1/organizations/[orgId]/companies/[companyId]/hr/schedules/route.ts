import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSchedule, listSchedules, scheduleInput } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listSchedules(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/schedules", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createSchedule(ctx, orgId, companyId, await body(req, scheduleInput)));
