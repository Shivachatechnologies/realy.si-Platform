import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { purgeUserInput, purgeUserNow } from "@/server/modules/admin/users";

/** Purge a pending deletion now (irreversible anonymization; typed confirmation). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/purge", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  purgeUserNow(ctx, userId, await body(req, purgeUserInput)),
);
