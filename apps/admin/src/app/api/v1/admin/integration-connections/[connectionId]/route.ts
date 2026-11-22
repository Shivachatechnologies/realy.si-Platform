import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminDisconnectIntegration } from "@/server/modules/admin/integrations";

/** Disconnect any organization's integration connection (platform.organizations.manage or platform.controls.manage). */
export const DELETE = route<{ connectionId: string }>({ auth: "required", name: "DELETE /admin/integration-connections/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { connectionId }) =>
  adminDisconnectIntegration(ctx, connectionId, await body(req, z.object({ reason: z.string() }))),
);
