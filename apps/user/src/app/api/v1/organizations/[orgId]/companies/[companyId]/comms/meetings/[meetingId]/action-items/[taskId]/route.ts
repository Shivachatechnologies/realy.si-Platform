import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { actionItemStatusInput, setActionItemStatus } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string; taskId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId/action-items/:taskId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, meetingId, taskId }) => setActionItemStatus(ctx, orgId, companyId, meetingId, taskId, await body(req, actionItemStatusInput)),
);
