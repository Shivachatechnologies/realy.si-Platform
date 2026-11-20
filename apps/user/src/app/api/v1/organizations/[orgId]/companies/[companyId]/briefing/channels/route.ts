import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { channelConfigInput, getChannelSettings, saveChannelSettings } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getChannelSettings(ctx, orgId, companyId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/briefing/channels", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveChannelSettings(ctx, orgId, companyId, await body(req, channelConfigInput)),
);
