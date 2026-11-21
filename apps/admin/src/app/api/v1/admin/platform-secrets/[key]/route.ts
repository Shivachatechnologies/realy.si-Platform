import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { clearPlatformSecret, clearPlatformSecretInput, setPlatformSecret, setPlatformSecretInput } from "@/server/modules/admin/platform-secrets";

/** Set the admin value of a platform key (write-only; MFA-gated permission; audited). */
export const PUT = route<{ key: string }>({ auth: "required", name: "PUT /admin/platform-secrets/:key", rateLimits: LIMITS.platformSecrets, maxBodyBytes: 16 * 1024 }, async ({ req, ctx }, { key }) =>
  setPlatformSecret(ctx, key, await body(req, setPlatformSecretInput)),
);

/** Remove the admin value: the key reverts to the hosting environment. */
export const DELETE = route<{ key: string }>({ auth: "required", name: "DELETE /admin/platform-secrets/:key", rateLimits: LIMITS.platformSecrets }, async ({ req, ctx }, { key }) =>
  clearPlatformSecret(ctx, key, await body(req, clearPlatformSecretInput)),
);
