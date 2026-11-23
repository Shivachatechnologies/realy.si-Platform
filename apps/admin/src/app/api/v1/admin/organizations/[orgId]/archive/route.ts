import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { closeOrgInput, closeOrganization, reopenOrganization, reopenOrgInput } from "@/server/modules/admin/tenants";

/** Archive the organization (status CLOSED; typed confirmation: its slug). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/organizations/:id/archive", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  closeOrganization(ctx, orgId, await body(req, closeOrgInput)),
);

/** Reopen an archived organization. */
export const DELETE = route<{ orgId: string }>({ auth: "required", name: "DELETE /admin/organizations/:id/archive", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  reopenOrganization(ctx, orgId, await body(req, reopenOrgInput)),
);
