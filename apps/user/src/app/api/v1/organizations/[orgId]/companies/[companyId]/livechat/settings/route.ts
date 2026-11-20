import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getLivechatSettings, settingsInput, updateLivechatSettings } from "@/server/modules/livechat/settings";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getLivechatSettings(ctx, orgId, companyId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/livechat/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => updateLivechatSettings(ctx, orgId, companyId, await body(req, settingsInput)),
);
