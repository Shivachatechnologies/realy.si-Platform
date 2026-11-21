import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateUserProfile, userProfileInput } from "@/server/modules/admin/people";

/** Edit a user's profile (name, email, locale, time zone) with a reason (platform.users.manage). */
export const PUT = route<{ userId: string }>({ auth: "required", name: "PUT /admin/users/:id/profile", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  updateUserProfile(ctx, userId, await body(req, userProfileInput)),
);
