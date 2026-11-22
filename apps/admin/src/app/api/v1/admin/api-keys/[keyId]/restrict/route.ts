import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { apiKeyRestrictInput, restrictApiKey } from "@/server/modules/admin/developers";

/** Narrow scopes and/or bring the expiry forward (rotation grace period) (platform.security.manage). */
export const POST = route<{ keyId: string }>({ auth: "required", name: "POST /admin/api-keys/:keyId/restrict", rateLimits: LIMITS.admin }, async ({ req, ctx }, { keyId }) => restrictApiKey(ctx, keyId, await body(req, apiKeyRestrictInput)));
