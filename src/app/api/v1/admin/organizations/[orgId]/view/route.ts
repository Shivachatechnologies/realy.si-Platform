import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { recordTenantView, tenantViewInput } from "@/server/modules/admin/tenants";

/** Record the reason for opening a tenant's details (audit: platform.tenant_viewed). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/organizations/:id/view", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  recordTenantView(ctx, orgId, await body(req, tenantViewInput)),
);
