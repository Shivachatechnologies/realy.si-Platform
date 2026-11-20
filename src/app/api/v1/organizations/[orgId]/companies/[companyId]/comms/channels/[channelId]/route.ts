import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteChannel, getChannel, updateChannel, updateChannelInput } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string; channelId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, channelId }) => getChannel(ctx, orgId, companyId, channelId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/channels/:channelId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, channelId }) => updateChannel(ctx, orgId, companyId, channelId, await body(req, updateChannelInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/channels/:channelId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, channelId }) => deleteChannel(ctx, orgId, companyId, channelId),
);
