import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { syncInterviewCalendar } from "@/server/modules/hr/interview-calendar";

type P = { orgId: string; companyId: string; id: string };

/** (Re)send the interview to the connected calendar. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/interviews/:id/calendar", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) =>
  syncInterviewCalendar(ctx, orgId, companyId, id),
);
