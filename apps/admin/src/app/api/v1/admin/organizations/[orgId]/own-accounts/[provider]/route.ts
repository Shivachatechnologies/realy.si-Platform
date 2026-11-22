import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminOwnAccountInput, adminSetOwnAccountCredentials } from "@/server/modules/admin/org-integrations";

/**
 * Set up or rotate an organization's own credentials for one provider (Realy team, MFA-gated platform permission,
 * reason required). The credentials are verified with the provider's connection test; the response never contains them.
 */
export const PUT = route<{ orgId: string; provider: string }>({ auth: "required", name: "PUT /admin/organizations/:id/own-accounts/:provider", rateLimits: LIMITS.platformSecrets }, async ({ req, ctx }, { orgId, provider }) =>
  adminSetOwnAccountCredentials(ctx, orgId, provider, await body(req, adminOwnAccountInput)),
);
