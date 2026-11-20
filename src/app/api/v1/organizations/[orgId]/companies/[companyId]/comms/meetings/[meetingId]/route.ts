import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteMeeting, getMeeting, updateMeeting, updateMeetingInput } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, meetingId }) => getMeeting(ctx, orgId, companyId, meetingId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, meetingId }) => updateMeeting(ctx, orgId, companyId, meetingId, await body(req, updateMeetingInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, meetingId }) => deleteMeeting(ctx, orgId, companyId, meetingId),
);
