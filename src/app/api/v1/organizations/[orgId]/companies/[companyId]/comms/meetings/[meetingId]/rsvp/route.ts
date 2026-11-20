import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rsvpInput, rsvpMeeting } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string };
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId/rsvp", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, meetingId }) => rsvpMeeting(ctx, orgId, companyId, meetingId, await body(req, rsvpInput)),
);
