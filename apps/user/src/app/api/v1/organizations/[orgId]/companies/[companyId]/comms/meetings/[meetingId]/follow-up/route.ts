import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { followUpInput, sendMeetingFollowUp } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string };
/** Email the meeting summary to attendees; returns { sent, failed, notConfigured, skipped }. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId/follow-up", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, meetingId }) => sendMeetingFollowUp(ctx, orgId, companyId, meetingId, await body(req, followUpInput)),
);
