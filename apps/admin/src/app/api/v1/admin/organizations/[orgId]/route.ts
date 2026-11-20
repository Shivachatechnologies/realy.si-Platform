import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminEditOrganization, editOrgInput } from "@/server/modules/admin/people";

/** Edit an organization's name, slug or default locale. */
export const PUT = route<{ orgId: string }>({ auth: "required", name: "PUT /admin/organizations/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  adminEditOrganization(ctx, orgId, await body(req, editOrgInput)),
);
