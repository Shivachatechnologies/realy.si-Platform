import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { orgStatusInput, setOrganizationStatus } from "@/server/modules/admin/controls";

export const PUT = route<{ orgId: string }>({ auth: "required", name: "PUT /admin/organizations/:id/status", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  setOrganizationStatus(ctx, orgId, await body(req, orgStatusInput)),
);
