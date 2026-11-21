import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminRevokeApiKey } from "@/server/modules/admin/integrations";

/** Revoke any organization's API key (platform.security.manage). */
export const DELETE = route<{ keyId: string }>({ auth: "required", name: "DELETE /admin/api-keys/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { keyId }) =>
  adminRevokeApiKey(ctx, keyId, await body(req, z.object({ reason: z.string() }))),
);
