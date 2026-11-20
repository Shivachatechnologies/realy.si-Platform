import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getSettings, settingsInput, updateSettings } from "@/server/modules/growth/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getSettings(ctx, orgId, companyId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/growth/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => updateSettings(ctx, orgId, companyId, await body(req, settingsInput)),
);
