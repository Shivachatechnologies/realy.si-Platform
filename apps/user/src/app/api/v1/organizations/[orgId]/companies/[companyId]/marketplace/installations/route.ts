import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { installInput, installListing, listInstallations } from "@/server/modules/marketplace/install";

type P = { orgId: string; companyId: string };

/** GET ?all=1 includes uninstalled. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listInstallations(ctx, orgId, companyId, {
    includeUninstalled: req.nextUrl.searchParams.get("all") === "1",
  }),
}));
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/marketplace/installations",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId, companyId }) => installListing(ctx, orgId, companyId, await body(req, installInput)),
);
