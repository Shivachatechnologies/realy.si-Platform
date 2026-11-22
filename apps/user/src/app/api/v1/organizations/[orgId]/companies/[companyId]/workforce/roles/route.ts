import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createRole, listRoles, roleInput } from "@/server/modules/workforce/roles";

type P = { orgId: string; companyId: string };

/** The company's own AI roles (B24): list, create. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listRoles(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/roles", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createRole(ctx, orgId, companyId, await body(req, roleInput)),
);
