import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addMembers, membersInput, removeMember } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string; channelId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/channels/:channelId/members", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, channelId }) => addMembers(ctx, orgId, companyId, channelId, await body(req, membersInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/channels/:channelId/members", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, channelId }) => removeMember(ctx, orgId, companyId, channelId, req.nextUrl.searchParams.get("userId") ?? ""),
);
