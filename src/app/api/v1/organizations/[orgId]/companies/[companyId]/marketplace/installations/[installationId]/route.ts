import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { installationPatchInput, setPinned, uninstall } from "@/server/modules/marketplace/install";

type P = { orgId: string; companyId: string; installationId: string };

/** { pinned } — pin to the installed version (no upgrade prompts) or unpin. */
export const PATCH = route<P>(
  {
    auth: "required",
    name: "PATCH /organizations/:orgId/companies/:companyId/marketplace/installations/:installationId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, p) => setPinned(ctx, p.orgId, p.companyId, p.installationId, await body(req, installationPatchInput)),
);
/** Uninstall (records the installation created are kept). */
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/companies/:companyId/marketplace/installations/:installationId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, p) => uninstall(ctx, p.orgId, p.companyId, p.installationId),
);
