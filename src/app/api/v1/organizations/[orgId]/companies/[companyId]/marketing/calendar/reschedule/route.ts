import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rescheduleInput, rescheduleItem } from "@/server/modules/marketing/calendar";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/calendar/reschedule", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => rescheduleItem(ctx, orgId, companyId, await body(req, rescheduleInput)));
