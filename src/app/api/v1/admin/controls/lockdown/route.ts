import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { endLockdown, lockdownInput, startLockdown } from "@/server/modules/admin/controls";

export const POST = route({ auth: "required", name: "POST /admin/controls/lockdown", rateLimits: LIMITS.admin }, async ({ req, ctx }) => startLockdown(ctx, await body(req, lockdownInput)));

export const DELETE = route({ auth: "required", name: "DELETE /admin/controls/lockdown", rateLimits: LIMITS.admin }, async ({ req, ctx }) =>
  endLockdown(ctx, await body(req, z.object({ reason: z.string() }))),
);
