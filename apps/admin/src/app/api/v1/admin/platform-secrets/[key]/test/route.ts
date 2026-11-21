import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { testPlatformSecret, testPlatformSecretInput } from "@/server/modules/admin/platform-secrets";

/** Side-effect-free provider check of a candidate or the active value (audited, rate-limited). */
export const POST = route<{ key: string }>({ auth: "required", name: "POST /admin/platform-secrets/:key/test", rateLimits: LIMITS.platformSecrets, maxBodyBytes: 16 * 1024 }, async ({ req, ctx }, { key }) =>
  testPlatformSecret(ctx, key, await body(req, testPlatformSecretInput)),
);
