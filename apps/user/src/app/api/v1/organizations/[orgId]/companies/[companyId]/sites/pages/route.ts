import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { createPage, createPageInput, listPages } from "@/server/modules/sites/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/sites/pages" }, async ({ ctx }, { orgId, companyId }) => listPages(ctx, orgId, companyId));

/** New page or landing page (blank, landing layout, or a copy of another page). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites/pages", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  createPage(ctx, orgId, companyId, await body(req, createPageInput)),
);
