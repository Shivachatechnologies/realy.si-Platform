import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { actionItemsInput, createActionItems, proposedActionItems } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; meetingId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, meetingId }) => proposedActionItems(ctx, orgId, companyId, meetingId, req.nextUrl.searchParams.get("fromTask") ?? ""));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meetings/:meetingId/action-items", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, meetingId }) => createActionItems(ctx, orgId, companyId, meetingId, await body(req, actionItemsInput)),
);
