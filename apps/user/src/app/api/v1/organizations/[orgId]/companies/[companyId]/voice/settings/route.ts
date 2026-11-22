import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveSettings } from "@/server/modules/voice/agents";
import { settingsInput } from "@/server/modules/voice/service";
import { adminManaged } from "@/server/modules/integrations/customer-access";

type P = { orgId: string; companyId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voice/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => {
    const input = await body(req, settingsInput);
    // SIP bridge credentials are never entered by customers (docs/integrations.md "Who manages what").
    if (input.sipPassword !== undefined || input.sipUsername !== undefined) throw adminManaged("credentials", { fields: ["sipUsername", "sipPassword"] });
    return saveSettings(ctx, orgId, companyId, input);
  },
);
