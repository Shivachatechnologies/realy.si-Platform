import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryMeetingCalendar } from "@/server/modules/crm/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

/** Try again to add the meeting to the connected calendar. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/meetings/:meetingId/calendar", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, meetingId }) => retryMeetingCalendar(ctx, orgId, companyId, meetingId),
);
