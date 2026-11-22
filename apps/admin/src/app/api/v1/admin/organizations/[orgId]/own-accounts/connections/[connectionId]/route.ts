import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminRemoveOwnAccount } from "@/server/modules/admin/org-integrations";

/** Remove an organization's own-account connection (revokes at the provider where supported), with a reason. */
export const DELETE = route<{ orgId: string; connectionId: string }>({ auth: "required", name: "DELETE /admin/organizations/:id/own-accounts/connections/:connectionId", rateLimits: LIMITS.platformSecrets }, async ({ req, ctx }, { orgId, connectionId }) =>
  adminRemoveOwnAccount(ctx, orgId, connectionId, await body(req, z.object({ reason: z.string() }))),
);
