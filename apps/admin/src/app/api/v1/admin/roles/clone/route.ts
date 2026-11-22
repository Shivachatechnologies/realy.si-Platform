import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { z } from "zod";
import { clonePlatformRole, clonePlatformRoleInput } from "@/server/modules/admin/roles";

/** Clone a built-in (by key) or custom (by id) platform role into a new custom role. */
export const POST = route({ auth: "required", name: "POST /admin/roles/clone", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => {
  const input = await body(req, clonePlatformRoleInput.extend({ source: z.string().max(64) }));
  return clonePlatformRole(ctx, input.source, input);
});
