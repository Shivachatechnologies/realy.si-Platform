import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createMeeting, listMeetings, meetingInput, parseMeetingFilters } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listMeetings(ctx, orgId, companyId, parseMeetingFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meetings", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createMeeting(ctx, orgId, companyId, await body(req, meetingInput)),
);
