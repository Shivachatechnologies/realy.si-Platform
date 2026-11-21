import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { listPlatformSecrets } from "@/server/modules/admin/platform-secrets";

/** Platform keys with their status (source, last 4, who changed them). Never returns a secret value. */
export const GET = route({ auth: "required", name: "GET /admin/platform-secrets", rateLimits: LIMITS.admin }, async ({ ctx }) => listPlatformSecrets(ctx));
