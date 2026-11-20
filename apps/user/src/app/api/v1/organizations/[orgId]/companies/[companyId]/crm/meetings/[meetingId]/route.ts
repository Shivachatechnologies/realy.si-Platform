import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { crmMeetingPatch, updateMeetingStatus } from "@/server/modules/crm/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/meetings/:meetingId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, meetingId }) => updateMeetingStatus(ctx, orgId, companyId, meetingId, await body(req, crmMeetingPatch)),
);
