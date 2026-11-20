import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { completeMeeting } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId/complete", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, meetingId }) => completeMeeting(ctx, orgId, companyId, meetingId),
);
