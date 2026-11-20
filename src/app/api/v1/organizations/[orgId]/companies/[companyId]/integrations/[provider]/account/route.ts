import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { activeAccountInput, setActiveAccount } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

/** Choose the active sub-account (page, channel, ad account, site...) of a connection. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/account", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, provider }) => setActiveAccount(ctx, orgId, companyId, provider, await body(req, activeAccountInput)),
);
