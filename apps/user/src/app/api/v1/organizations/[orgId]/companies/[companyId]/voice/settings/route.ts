import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveSettings } from "@/server/modules/voice/agents";
import { settingsInput } from "@/server/modules/voice/service";

type P = { orgId: string; companyId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voice/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => saveSettings(ctx, orgId, companyId, await body(req, settingsInput)),
);
