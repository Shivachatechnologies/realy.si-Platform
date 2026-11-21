import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { orgOverrideInput, setOrgOverride } from "@/server/modules/admin/controls";

export const PUT = route<{ orgId: string }>({ auth: "required", name: "PUT /admin/organizations/:id/restrictions", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  setOrgOverride(ctx, orgId, await body(req, orgOverrideInput)),
);
