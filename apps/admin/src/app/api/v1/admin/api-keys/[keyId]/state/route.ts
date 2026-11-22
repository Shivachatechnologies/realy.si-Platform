import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { apiKeyStateInput, setApiKeyDisabled } from "@/server/modules/admin/developers";

/** Disable / re-enable an API key without revoking it (platform.security.manage). */
export const PUT = route<{ keyId: string }>({ auth: "required", name: "PUT /admin/api-keys/:keyId/state", rateLimits: LIMITS.admin }, async ({ req, ctx }, { keyId }) => setApiKeyDisabled(ctx, keyId, await body(req, apiKeyStateInput)));
