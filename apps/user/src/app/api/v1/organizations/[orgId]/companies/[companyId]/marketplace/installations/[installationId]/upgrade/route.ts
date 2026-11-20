import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { upgradeInput, upgradeInstallation } from "@/server/modules/marketplace/install";

type P = { orgId: string; companyId: string; installationId: string };

export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/marketplace/installations/:installationId/upgrade",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, p) => upgradeInstallation(ctx, p.orgId, p.companyId, p.installationId, await body(req, upgradeInput)),
);
