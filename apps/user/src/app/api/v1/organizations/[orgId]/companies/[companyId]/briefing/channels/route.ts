import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { channelConfigInput, getChannelSettings, saveChannelSettings } from "@/server/modules/briefing/service";
import { adminManaged } from "@/server/modules/integrations/customer-access";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getChannelSettings(ctx, orgId, companyId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/briefing/channels", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => {
    const input = await body(req, channelConfigInput);
    // The Meta app secret is Realy's (WHATSAPP_APP_SECRET in Admin → Platform keys); customers never enter it.
    if (input.metaAppSecret) throw adminManaged("credentials", { fields: ["metaAppSecret"] });
    return saveChannelSettings(ctx, orgId, companyId, input);
  },
);
