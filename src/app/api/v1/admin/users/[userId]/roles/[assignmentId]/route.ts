import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokePlatformRole } from "@/server/modules/admin/users";

export const DELETE = route<{ userId: string; assignmentId: string }>(
  { auth: "required", name: "DELETE /admin/users/:id/roles/:assignmentId", rateLimits: LIMITS.admin },
  async ({ req, ctx }, { userId, assignmentId }) => revokePlatformRole(ctx, userId, assignmentId, await body(req, z.object({ reason: z.string() }))),
);
